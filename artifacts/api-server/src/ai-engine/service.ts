import { PreviewCharacterDecisionBody, SaveUniverseBody, type CharacterDecisionInput } from '@workspace/api-zod';
import { EngineError, type TextProvider } from './contracts';
import { previewDecision } from './engine';
import type { VisionContext } from '../vision/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { parseDmConversationPreferences, type DmConversationPreferences } from './dm-conversation-preferences';
import { db, echoMemoryArchiveTable, echoCharacterGalleryTable } from '@workspace/db';
import { kindroidDmProvider } from './kindroid';
import { canCharacterViewCloseFriendsStory } from '../lib/storySharePolicy';
import { buildCharacterContext } from './context';
import { visibleSeenStoriesForKindroid, kindroidMemoryAllowed } from '../lib/kindroidSocialPrivacy';
import { relevantWorldJournals } from '../lib/worldJournalRecall';

/** Owner must come from verified server authentication, never from request JSON. */
export async function previewForOwner(ownerId: string, input: CharacterDecisionInput, dependencies: {
  read: (ownerId: string, universeId?: string) => Promise<{ state: unknown; revision: number }>;
  provider: TextProvider;
  vision?: (ownerId: string, state: import('@workspace/api-zod').SocialState, input: CharacterDecisionInput) => Promise<VisionContext>;
  liveDmReply?: boolean;
}) {
  if (!ownerId) throw new EngineError('AUTHENTICATION_REQUIRED', 401);
  if (!PreviewCharacterDecisionBody.strict().safeParse(input).success) throw new EngineError('INVALID_PREVIEW_INPUT');
  const snapshot = await dependencies.read(ownerId, input.universeId ?? 'primary');
  if (!snapshot.state) throw new EngineError('UNIVERSE_NOT_FOUND', 404);
  const parsed = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!parsed.success) throw new EngineError('INVALID_STORED_UNIVERSE', 422);
  const actor = parsed.data.state.characters.find(c => c.id === input.characterId);
  const personId = actor?.personId || actor?.id || input.characterId;
  const linkedAccountIds = parsed.data.state.characters
    .filter(c => (c.personId || c.id) === personId)
    .map(c => c.id);
  const historical = process.env.ECHO_MEMORY_ARCHIVE_ENABLED === 'true'
    ? await db.select({ memoryId: echoMemoryArchiveTable.memoryId, sourceId: echoMemoryArchiveTable.sourceId,
      kind: echoMemoryArchiveTable.kind, targetId: echoMemoryArchiveTable.targetId,
      content: echoMemoryArchiveTable.content, occurredAt: echoMemoryArchiveTable.occurredAt })
      .from(echoMemoryArchiveTable).where(and(
        eq(echoMemoryArchiveTable.ownerId, ownerId),
        eq(echoMemoryArchiveTable.universeId, input.universeId ?? 'primary'),
        inArray(echoMemoryArchiveTable.characterId, linkedAccountIds),
      )).orderBy(desc(echoMemoryArchiveTable.occurredAt)).limit(150)
    : [];
  const vision = dependencies.vision
    ? await dependencies.vision(ownerId, parsed.data.state, input)
    : { analyses: {}, postSummaries: {} };
  // Narrative language is independent of the owner's interface language.
  // Each character's configured voice.outputLanguage takes precedence in previewDecision.
  const language = 'en';
  // Supply cached visual observations before the character decides what to say.
  // Never trigger vision billing in the autonomous decision loop.
  const gallery = input.situation === 'post'
    ? await db.select().from(echoCharacterGalleryTable).where(and(
        eq(echoCharacterGalleryTable.ownerId,ownerId),
        eq(echoCharacterGalleryTable.universeId,input.universeId ?? 'primary'),
        eq(echoCharacterGalleryTable.characterId,input.characterId),
        eq(echoCharacterGalleryTable.reserved,false),
      ))
    : [];
  const galleryContext = gallery.filter(photo => (photo.reusable || photo.usedCount === 0) &&
    (!photo.lastUsedAt || photo.usedCount === 0 || Date.now() - photo.lastUsedAt.getTime() >= 30 * 24 * 60 * 60_000))
    .slice(0,20).map(photo => {
      const analysis = photo.visionStatus === 'complete' ? photo.visionAnalysis : null;
      return {
        id: photo.id,
        note: photo.description.slice(0,240),
        scene: typeof analysis?.sceneDescription === 'string' ? analysis.sceneDescription.slice(0,360) : '',
        setting: typeof analysis?.setting === 'string' ? analysis.setting.slice(0,140) : '',
        activities: Array.isArray(analysis?.activities) ? analysis.activities.slice(0,6) : [],
      };
    });
  let dmPreferences: DmConversationPreferences | undefined;
  if (input.situation === 'dm') {
    try {
      const stored = await db.execute(sql`SELECT preferences FROM echo_dm_conversation_preferences
        WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'} AND character_id = ${input.characterId} LIMIT 1`);
      if (stored.rows[0]?.preferences) dmPreferences = parseDmConversationPreferences(stored.rows[0].preferences);
    } catch (error) {
      console.warn('DM preference lookup skipped', { reason: error instanceof Error ? error.name : 'UNKNOWN' });
    }
  }
  // Linked Kin IDs are stored server-side, never exposed to the client.
  // Only the founder's direct incoming DM lane is routed; social actions stay native.
  let selectedProvider = dependencies.provider;
  // Linked characters use their own Kindroid voice for public text too.
  // ECHO still selects the opportunity and validates the draft before execution.
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
      (input.situation === 'comment' || input.situation === 'post')) {
    const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    if (typeof kinId === 'string' && kinId.length > 0) {
      const targetPost = input.postId ? parsed.data.state.posts.find(p => p.id === input.postId) : undefined;
      const targetComment = input.commentId ? parsed.data.state.comments.find(c => c.id === input.commentId) : undefined;
      // Do not pass private messages, hidden stories, or unrelated account data.
      const publicContext = targetPost
        ? `Visible feed post: ${(targetPost.caption ?? '').slice(0, 500)}${targetComment ? '\nReplying to comment by ' + (parsed.data.state.characters.find(c => c.id === targetComment.authorId)?.name ?? 'another person') + ': ' + targetComment.text.slice(0, 300) : ''}`
        : '';
      const prompt = input.situation === 'comment'
        ? `[ECHO social action: Write ONE short, natural public comment on the visible post, in your established voice and in English. Stay in character; no narration or JSON. Do not invent private knowledge.]${publicContext ? '\n' + publicContext : ''}`
        : '[ECHO social action: Write ONE natural feed caption in your established voice and in English. No JSON or stage directions. Do not invent private events.]';
      if (input.situation === 'post' || targetPost) {
        selectedProvider = kindroidDmProvider(prompt, kinId, '', undefined, input.situation);
      }
    }
  }
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' && input.situation === 'dm' &&
      !!input.recipientId && input.recipientId !== input.characterId) {
    const links = await db.execute(sql`SELECT kin_id, social_context_enabled, context_reset_at FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    if (typeof kinId === 'string' && kinId.length > 0) {
      const recipientId = input.recipientId!;
      const thread = parsed.data.state.messages
        .filter(m => (m.senderId === recipientId && m.recipientId === input.characterId) ||
                     (m.senderId === input.characterId && m.recipientId === recipientId))
        .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const newest = thread[0];
      // A linked Kin writes both direct replies and spontaneous DMs. Never
      // fabricate an incoming human message just to make Kindroid respond.
      const isDirectReply = newest?.senderId === recipientId && typeof newest.text === 'string' && !!newest.text.trim();
      if (isDirectReply || dependencies.liveDmReply) {
        const storyForReply = input.storyId ? parsed.data.state.stories.find(story =>
          story.id === input.storyId && story.authorId === recipientId && canCharacterViewCloseFriendsStory(parsed.data.state, story, input.characterId)) : undefined;
        const outgoingPrompt = storyForReply
          ? `[ECHO private story reply: You viewed a story by ${parsed.data.state.characters.find(c => c.id === recipientId)?.name ?? 'this person'}. Caption: ${(storyForReply.caption ?? '').slice(0,400)}. Write one natural private DM about the story in your established voice, in English. Do not invent details or claim they messaged you.]`
          : isDirectReply
            ? newest!.text
            : `[ECHO autonomous DM: You have decided to reach out to ${parsed.data.state.characters.find(c => c.id === recipientId)?.name ?? 'this person'} on your own. Write one natural message in your established voice, in English. Do not claim they messaged you or invent a reply from them.]`;
        let socialContext = '';
        if (links.rows[0]?.social_context_enabled === true) {
          // Reuse ECHO's actor-visible context builder, not a raw global feed dump.
          // Exclude private DMs and ECHO personality: Kindroid owns the character voice.
          const resetAtRaw = links.rows[0]?.context_reset_at;
          const resetAt = resetAtRaw ? new Date(String(resetAtRaw)).getTime() : 0;
          const sinceReset = (createdAt: string | Date | undefined | null) =>
            !!createdAt && new Date(createdAt).getTime() >= resetAt;
          // For linked founder Kindroids, ECHO's pre-reset activity is not part of the new story.
          // Keep Kindroid's own memories untouched and filter before building social context.
          const freshState = {
            ...parsed.data.state,
            posts: parsed.data.state.posts.filter(p => sinceReset(p.createdAt)),
            comments: parsed.data.state.comments.filter(c => sinceReset(c.createdAt)),
            stories: parsed.data.state.stories.filter(st => sinceReset(st.createdAt)),
            messages: parsed.data.state.messages.filter(m => sinceReset(m.createdAt)),
          };
          const freshHistorical = historical.filter(h => sinceReset(h.occurredAt));
          const scoped = buildCharacterContext(freshState, input, new Date(), vision, freshHistorical);
          const data = JSON.parse(scoped.serialized) as {
            recentSocial?: { posts?: Array<{ id?:string; author?: {name?:string}; caption?:string; createdAt?:string; visionSummary?:string|null }>;
              comments?: Array<{author?:{name?:string};text?:string;postId?:string}> }; memory?: { historicalRecalled?: Array<{kind?:string;targetId?:string|null;text?:string}> };
          };
          const posts = (data.recentSocial?.posts ?? []).slice(-5).map(p =>
            `Post by ${(p.author?.name ?? 'Unknown').slice(0,60)}: ${(p.caption ?? '').slice(0,220)}${p.visionSummary ? ' | Image: '+p.visionSummary.slice(0,150):''}`);
          const comments = (data.recentSocial?.comments ?? []).slice(-5).map(m =>
            `Comment by ${(m.author?.name ?? 'Unknown').slice(0,60)}: ${(m.text ?? '').slice(0,180)}`);
          // Recover older public posts on demand from persisted ECHO history.
          // The author must be followed by the actor (or be the actor); never
          // retrieve private messages, restricted stories, or unrelated accounts.
          const terms = new Set(((newest?.text ?? '').toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
            .filter(t => !['what','have','your','with','this','that','about','latest','post','posted','viste','publicacion','publicaste','sobre','esto','esta','para','como'].includes(t)));
          const visibleAuthorIds = new Set([input.characterId, ...(parsed.data.state.follows[input.characterId] ?? [])]);
          const recentIds = new Set((data.recentSocial?.posts ?? []).map(p => p.id));
          // Old posts remain browsable on explicit request; they are not spontaneous memories.
          const asksAboutPost = /\b(post|posts|posted|posting|publication|picture|photo|painting|drawing|sketch|artwork|feed|publicaci[oó]n|publicaciones|publicaste|subiste|foto|pintura|dibujo|boceto|perfil)\b/i.test(newest?.text ?? '');
          const older = asksAboutPost && terms.size ? freshState.posts
            .filter(p => visibleAuthorIds.has(p.authorId) && !recentIds.has(p.id))
            .map(p => {
              const author = parsed.data.state.characters.find(ch => ch.id === p.authorId);
              const haystack = [p.caption,author?.name,author?.handle].filter(Boolean).join(' ').toLocaleLowerCase();
              const score = [...terms].filter(term => haystack.includes(term)).length;
              return {p,author,score};
            })
            .filter(x => x.score > 0)
            .sort((a,b) => b.score-a.score || new Date(b.p.createdAt).getTime()-new Date(a.p.createdAt).getTime())
            .slice(0,3)
            .map(x => `Older ECHO post (${new Date(x.p.createdAt).toISOString().slice(0,10)}) by ${(x.author?.name ?? 'Unknown').slice(0,60)}: ${x.p.caption.slice(0,260)}`) : [];
          // Stories are only remembered if this actor actually viewed them.
          // Never infer story viewing from a follow alone.
          const seenStories = visibleSeenStoriesForKindroid(freshState, input.characterId)
            .sort((a,b) => new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())
            .slice(0,3)
            .map(s => {
              const author = parsed.data.state.characters.find(ch => ch.id === s.authorId);
              return `Story actually viewed by this character, posted by ${(author?.name ?? 'Unknown').slice(0,60)}: ${s.caption.slice(0,200)}`;
            });
          // The shared context builder already ranks archived memories and
          // scopes private conversation memories to this exact DM recipient.
          const memories = (data.memory?.historicalRecalled ?? []).slice(0,3)
            .filter(m => kindroidMemoryAllowed(m, 'nela'))
            .map(m => `Earlier ECHO memory (${(m.kind ?? 'event').slice(0,32)}): ${(m.text ?? '').slice(0,350)}`);
          const journalFacts = await relevantWorldJournals(ownerId, input.universeId ?? 'primary', input.characterId, outgoingPrompt)
            .then(entries => entries.map(entry => `Known world journal (${entry.truthStatus}; ${entry.title}): ${entry.content}`))
            .catch(() => [] as string[]);
          const reservedJournalContext = journalFacts.join('\n').slice(0,2200);
          const socialBudget = Math.max(0, 5000 - reservedJournalContext.length - 1);
          const socialPart = [...posts,...comments,...older,...seenStories,...memories].join('\n').slice(0,socialBudget);
          socialContext = [reservedJournalContext,socialPart].filter(Boolean).join('\n');
        }
        // World knowledge is independent of the optional social-context toggle.
        // Restrict it to approved entries visible to this exact character.
        if (links.rows[0]?.social_context_enabled !== true) {
          const journalFacts = await relevantWorldJournals(ownerId, input.universeId ?? 'primary', input.characterId, outgoingPrompt)
            .catch(() => [] as Awaited<ReturnType<typeof relevantWorldJournals>>);
          socialContext = journalFacts.map(e => `Known world journal (${e.truthStatus}; ${e.title}): ${e.content}`).join('\n').slice(0,3200);
        }
        selectedProvider = kindroidDmProvider(outgoingPrompt, kinId, socialContext);
      }
    }
  }
  // Non-text social actions need no generative AI. The opportunity policy has
  // already checked visibility, follow relationships, cooldowns and repeat caps.
  // Avoid charging text-model budget merely to return a fixed like or a story
  // view. For story_reaction, a no-op decision still records a permitted view
  // through the autonomy executor; it must not invent an emoji reaction.
  if (dependencies.liveDmReply === true &&
      ['like_post', 'like_comment', 'story_reaction'].includes(input.situation)) {
    const situation = input.situation;
    selectedProvider = {
      name: 'echo-nontext-policy',
      async complete(request) {
        const decision = JSON.stringify({
          action: situation === 'story_reaction' ? 'none' : 'like',
          situation, text: null, reaction: null, reason: 'Eligible non-text social action',
          suggestedDelayMinutes: 0, galleryPhotoId: null, contextSections: [],
        });
        request.validate?.(decision);
        return { text: decision, model: 'echo-nontext-policy', usage: { promptTokens: 0, completionTokens: 0, cost: 0 }, attempts: [] };
      },
    };
  }
  // Founder universes: text actions are Kindroid-only. Never fall back when a
  // Kin link is missing, disabled, or Kindroid is unavailable. Non-text actions
  // (likes, story reactions, views) must remain eligible without a text model.
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
      (input.situation === 'dm' || input.situation === 'comment' || input.situation === 'post')) {
    const linkCheck = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    if (!linkCheck.rows.length || selectedProvider.name !== 'kindroid') {
      throw new EngineError('KINDROID_ONLY_NO_FALLBACK', 503);
    }
  }
  const journalQuery = [
    parsed.data.state.posts.find(p => p.id === input.postId)?.caption,
    parsed.data.state.stories.find(s => s.id === input.storyId)?.caption,
    parsed.data.state.messages.find(m => m.id === input.messageId)?.text,
    ...parsed.data.state.messages.filter(m =>
      (m.senderId === input.recipientId && m.recipientId === input.characterId) ||
      (m.senderId === input.characterId && m.recipientId === input.recipientId))
      .sort((a,b) => new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())
      .slice(0,3).map(m => m.text),
  ].filter(Boolean).join(' ');
  const approvedJournals = await relevantWorldJournals(ownerId, input.universeId ?? 'primary', input.characterId, journalQuery)
    .catch(() => [] as Awaited<ReturnType<typeof relevantWorldJournals>>);
  const journalContext = approvedJournals.map(e => `[${e.truthStatus}] ${e.title}: ${e.content}`).join('\n');
  return previewDecision(selectedProvider, parsed.data.state, input, snapshot.revision,
    new Date(), 'persisted_owner_universe', vision, historical, dependencies.liveDmReply ? 'live_dm_reply' : 'preview', language, galleryContext, dmPreferences, journalContext);
}
