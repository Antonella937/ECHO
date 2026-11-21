import { requiresIsolatedKindroidSocial, verifiedSocialGroupForActor } from './social-isolation';
import { kindroidSocialGroupProvider } from './kindroid-social-group';
import { PreviewCharacterDecisionBody, SaveUniverseBody, type CharacterDecisionInput } from '@workspace/api-zod';
import { EngineError, unknownUsage, type TextProvider } from './contracts';
import { previewDecision } from './engine';
import type { VisionContext } from '../vision/contracts';
import { visionService } from '../vision/service';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { parseDmConversationPreferences, type DmConversationPreferences } from './dm-conversation-preferences';
import { db, echoMemoryArchiveTable, echoCharacterGalleryTable } from '@workspace/db';
import { kindroidDmProvider, kindroidStoryDecisionProvider, kindroidLikeDecisionProvider, kindroidPeerGroupProvider } from './kindroid';
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
  // Likes and story views/reactions do not require image interpretation.
  // Skip vision loading to avoid unnecessary provider work on non-text actions.
  const isNonTextSocial = ['like_post', 'like_comment', 'story_reaction'].includes(input.situation);
  let vision: VisionContext = dependencies.vision && !isNonTextSocial
    ? await dependencies.vision(ownerId, parsed.data.state, input)
    : { analyses: {}, postSummaries: {} };
  // A story reply needs the image, not merely its caption. Analyze once through
  // the owner-scoped, content-hash cache and existing metered vision safeguards.
  // Never charge for story views, likes or reactions.
  if (input.storyId && !isNonTextSocial && !vision.analyses[`story:${input.storyId}:story:${input.storyId}`]) {
    const target = parsed.data.state.stories.find(story => story.id === input.storyId);
    if (target && canCharacterViewCloseFriendsStory(parsed.data.state, target, input.characterId)) {
      try {
        vision = await visionService.ensureForDecision(ownerId, parsed.data.state, input);
      } catch (error) {
        // If the image is unavailable, keep the reply functional without
        // pretending it was seen; errors remain visible in server logs.
        console.warn('ECHO_STORY_VISION_UNAVAILABLE', error instanceof Error ? error.message : 'unknown');
      }
    }
  }
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
  // Independent social generation uses the ECHO character context and an
  // explicitly enabled stateless provider; it never calls Kindroid /send-message.
  // Opt-in is required because this provider can be metered.
  const founderSocial = requiresIsolatedKindroidSocial({
    live: dependencies.liveDmReply === true, ownerId, situation: input.situation,
  });
  const isolatedSocial = founderSocial && !!verifiedSocialGroupForActor(input.universeId ?? 'primary', input.characterId);
  // Never allow a private-history bypass: the founder requested isolation.
  if (founderSocial && !isolatedSocial) {
    throw new EngineError('KINDROID_SOCIAL_ISOLATION_REQUIRED', 503);
  }

  // Linked Kin IDs are stored server-side, never exposed to the client.
  // The founder's linked characters use Kindroid for live DMs and social decisions;
  // ECHO only schedules opportunities and enforces visibility/permission checks.
  let selectedProvider = dependencies.provider;
  if (founderSocial && isolatedSocial) {
    const groupId = verifiedSocialGroupForActor(input.universeId ?? 'primary', input.characterId);
    if (!groupId) throw new EngineError('KINDROID_SOCIAL_GROUP_NOT_VERIFIED', 503);
    const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    if (typeof kinId !== 'string' || !kinId) throw new EngineError('KINDROID_ONLY_NO_FALLBACK', 503);
    const post = input.postId ? parsed.data.state.posts.find(p => p.id === input.postId) : undefined;
    const comment = input.commentId ? parsed.data.state.comments.find(c => c.id === input.commentId) : undefined;
    const story = input.storyId ? parsed.data.state.stories.find(st => st.id === input.storyId) : undefined;
    // Reject mismatched targets before sending anything to Kindroid.
    if (input.situation === 'comment' && !post) throw new EngineError('SOCIAL_TARGET_POST_NOT_FOUND', 404);
    if (input.situation === 'like_post' && !post) throw new EngineError('SOCIAL_TARGET_POST_NOT_FOUND', 404);
    if (input.situation === 'like_comment' && !comment) throw new EngineError('SOCIAL_TARGET_COMMENT_NOT_FOUND', 404);
    if (input.situation === 'story_reaction' && !story) throw new EngineError('STORY_NOT_VISIBLE', 403);
    if (comment && post && comment.postId !== post.id) throw new EngineError('SOCIAL_COMMENT_POST_MISMATCH', 409);
    if (post && input.situation !== 'post' &&
        post.authorId !== input.characterId &&
        !parsed.data.state.follows[input.characterId]?.includes(post.authorId)) {
      throw new EngineError('SOCIAL_POST_NOT_VISIBLE', 403);
    }
    if (input.situation !== 'post' && !post && !comment && !story) {
      throw new EngineError('SOCIAL_TARGET_NOT_FOUND', 404);
    }
    if (story && (!canCharacterViewCloseFriendsStory(parsed.data.state, story, input.characterId) ||
        !parsed.data.state.follows[input.characterId]?.includes(story.authorId))) {
      throw new EngineError('STORY_NOT_VISIBLE', 403);
    }
    const context = [
      `Actor: ${actor?.name ?? input.characterId} (${input.characterId})`,
      post ? `Visible post by ${parsed.data.state.characters.find(c => c.id === post.authorId)?.name ?? post.authorId}: ${(post.caption ?? '[image or post without caption; visual content not analyzed]').slice(0,500)}` : '',
      comment ? `Visible comment by ${parsed.data.state.characters.find(c => c.id === comment.authorId)?.name ?? comment.authorId}: ${comment.text.slice(0,300)}` : '',
      story ? `Visible story by ${parsed.data.state.characters.find(c => c.id === story.authorId)?.name ?? story.authorId}: ${(story.caption ?? '[story without caption; visual content not analyzed]').slice(0,400)}` : '',
      'Use only this visible ECHO event; do not infer unseen image content or private messages.',
    ].filter(Boolean).join(String.fromCharCode(10));
    selectedProvider = kindroidSocialGroupProvider(groupId, kinId, input.situation as import('./social-isolation').FounderSocialSituation, context, input.characterId);
  }
  // Linked characters use their own Kindroid voice for public text too.
  // ECHO still selects the opportunity and validates the draft before execution.
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
      (input.situation === 'comment' || input.situation === 'post') && !isolatedSocial) {
    const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    // Founder live social text must never silently fall back to a metered model.
    if (typeof kinId !== 'string' || kinId.length === 0) {
      throw new EngineError('KINDROID_ONLY_NO_FALLBACK', 503);
    }
    {
      const targetPost = input.postId ? parsed.data.state.posts.find(p => p.id === input.postId) : undefined;
      const targetComment = input.commentId ? parsed.data.state.comments.find(c => c.id === input.commentId) : undefined;
      // Do not pass private messages, hidden stories, or unrelated account data.
      const publicContext = targetPost
        ? `Visible feed post: ${(targetPost.caption ?? '').slice(0, 500)}${targetComment ? '\nReplying to comment by ' + (parsed.data.state.characters.find(c => c.id === targetComment.authorId)?.name ?? 'another person') + ': ' + targetComment.text.slice(0, 300) : ''}`
        : '';
      const prompt = input.situation === 'comment'
        ? `[ECHO social action: Write a natural public comment on the visible post, in your established voice and in English. Preserve your personality and expressive style; format it as a public comment, not a private DM or JSON. Do not invent private knowledge.]${publicContext ? '\n' + publicContext : ''}`
        : '[ECHO social action: Write ONE natural feed caption in your established voice and in English. No JSON or stage directions. Do not invent private events.]';
      if (input.situation === 'comment' && !targetPost) {
        throw new EngineError('SOCIAL_TARGET_POST_NOT_FOUND', 404);
      }
      selectedProvider = kindroidDmProvider(prompt, kinId, '', undefined, input.situation, input.characterId);
    }
  }
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' && input.situation === 'dm' &&
      !!input.recipientId && input.recipientId !== input.characterId) {
    const links = await db.execute(sql`SELECT kin_id, social_context_enabled, context_reset_at FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    // Never silently switch a linked founder DM to Gemini when Kindroid
    // is disconnected. Preserve the pending message for a later retry.
    if (typeof kinId !== 'string' || kinId.length === 0) {
      throw new EngineError('KINDROID_ONLY_NO_FALLBACK', 503);
    }
    if (typeof kinId === 'string' && kinId.length > 0) {
      const recipientId = input.recipientId!;
      // Kindroid /send-message writes into the Kin's individual chat. Until a
      // separate Kindroid group_id is mapped to this peer thread, never send
      // character-to-character traffic into that private conversation.
      if (recipientId !== parsed.data.state.primaryCharacterId) {
        const pair = [input.characterId, recipientId].sort().join(':');
        // Peer groups are explicitly allowlisted. Never fall back to /send-message:
        // that endpoint would put a private peer conversation in Nela's Kin chat.
        const peerGroupIds: Record<string, string> = {
          [['account_mw6yjhc8v41bp', 'account_mw71qlrfmy74i'].sort().join(':')]: 'lSQ59nGePEfy3nCb6Gnp',
        };
        // Additional verified two-person group mappings can be configured without
        // changing this service. Invalid/missing mappings fail closed.
        const configuredGroups = process.env.ECHO_KINDROID_PEER_GROUPS_JSON;
        if (configuredGroups) {
          try {
            const parsedGroups: unknown = JSON.parse(configuredGroups);
            if (parsedGroups && typeof parsedGroups === 'object' && !Array.isArray(parsedGroups)) {
              for (const [key, value] of Object.entries(parsedGroups)) {
                const ids = key.split(':');
                if (ids.length !== 2 || ids.some(id => !/^[A-Za-z0-9_-]{2,160}$/.test(id)) ||
                    ids[0] === ids[1] || ids.slice().sort().join(':') !== key ||
                    typeof value !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(value)) continue;
                peerGroupIds[key] = value;
              }
            }
          } catch {
            // Malformed configuration cannot authorize a peer group.
          }
        }
        // These founder-specific Kindroid groups must not leak into another
        // universe that happens to reuse the same character identifiers.
        const peerGroupId = (input.universeId ?? 'primary') === 'primary' ? peerGroupIds[pair] : undefined;
        if (!peerGroupId) throw new EngineError('KINDROID_PEER_GROUP_REQUIRED', 409);
        if (input.storyId) {
          const targetStory = parsed.data.state.stories.find(story =>
            story.id === input.storyId && story.authorId === recipientId &&
            canCharacterViewCloseFriendsStory(parsed.data.state, story, input.characterId));
          if (!targetStory) throw new EngineError('STORY_REPLY_TARGET_UNAVAILABLE', 404);
        }
        selectedProvider = kindroidPeerGroupProvider(peerGroupId, kinId, input.characterId);
      } else {
      const thread = parsed.data.state.messages
        .filter(m => (m.senderId === recipientId && m.recipientId === input.characterId) ||
                     (m.senderId === input.characterId && m.recipientId === recipientId))
        .sort((a,b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime());
      const newest = thread[0];
      // A pair of identities can have multiple conversation threads.
      // Never pass messages from a different thread to the linked Kin.
      const activeThread = newest ? thread.filter(m => m.threadId === newest.threadId) : [];
      // The SocialState DM schema may not expose an attachment array.
      // Read optional metadata defensively without assuming media bytes exist.
      const describeDmMessage = (message: (typeof thread)[number]) => {
        const record = message as unknown as Record<string, unknown>;
        // Preserve complete ordinary multi-paragraph DMs (including closing questions).
        // Bound exceptionally long messages to protect the Kindroid prompt budget.
        const text = typeof record.text === 'string' ? record.text.slice(0, 4000) : '';
        const rawAttachments = Array.isArray(record.attachments) ? record.attachments : [];
        const attachments = rawAttachments.slice(0, 4).map((raw: unknown) => {
          if (!raw || typeof raw !== 'object') return '[attachment; content not analyzed]';
          const item = raw as Record<string, unknown>;
          const type = typeof item.type === 'string' ? item.type.slice(0, 32) : 'file';
          const duration = typeof item.durationSeconds === 'number' && Number.isFinite(item.durationSeconds)
            ? `, ${Math.round(item.durationSeconds)} seconds` : '';
          // Only expose metadata explicitly present on the attachment.
          // Never infer that the provider has listened to the audio.
          const title = typeof item.title === 'string' ? item.title.trim().slice(0, 120) : '';
          const artist = typeof item.artist === 'string' ? item.artist.trim().slice(0, 120) : '';
          const metadata = [title && `title: ${title}`, artist && `artist: ${artist}`].filter(Boolean).join(', ');
          return `[${type} attachment shared in ECHO${metadata ? `, ${metadata}` : ''}${duration}; content not analyzed]`;
        });
        const music = typeof record.musicTrackId === 'string' && record.musicTrackId.trim() 
          ? `[ECHO Music track shared${typeof record.musicTitle === 'string' ? `: ${record.musicTitle.slice(0, 120)}` : ''}; audio content not analyzed]` : '';
        return [text, music, ...attachments].filter(Boolean).join(' ');
      };
      // A linked Kin writes both direct replies and spontaneous DMs. Never
      // fabricate an incoming human message just to make Kindroid respond.
      const isDirectReply = newest?.senderId === recipientId && !!(newest.text?.trim() || newest.musicTrackId || (Array.isArray((newest as unknown as Record<string, unknown>).attachments) && ((newest as unknown as Record<string, unknown>).attachments as unknown[]).length > 0));
      if (isDirectReply || dependencies.liveDmReply) {
        const storyForReply = input.storyId ? parsed.data.state.stories.find(story =>
          story.id === input.storyId && story.authorId === recipientId && canCharacterViewCloseFriendsStory(parsed.data.state, story, input.characterId)) : undefined;
        // A missing, expired, or inaccessible story must not silently become
        // an unrelated unsolicited DM. Preserve the intended story target.
        if (input.storyId && !storyForReply) throw new EngineError('STORY_REPLY_TARGET_UNAVAILABLE', 404);
        const recipientName = (parsed.data.state.characters.find(c => c.id === recipientId)?.name ?? 'this person').slice(0,80);
        const actorName = (actor?.name ?? 'your character').slice(0,80);
        const ownerName = (parsed.data.state.characters.find(c => c.id === parsed.data.state.primaryCharacterId)?.name ?? 'the account owner').slice(0,80);
        // Kindroid's API maintains a Kin-wide conversation, whereas ECHO has
        // separate peer threads. Supply only this pair's recent DM turns and
        // explicitly establish both roles to prevent replies to the owner.
        // The latest incoming DM is appended separately below. Do not send it
        // twice or crowd it out with older turns in Kindroid's shared history.
        // Treat consecutive incoming messages as one turn when no character reply
        // intervened. This covers a music attachment followed by its caption.
        const latestTime = newest ? new Date(newest.createdAt).getTime() : NaN;
        const incomingBatch = isDirectReply ? activeThread.filter((m, index) =>
          index === 0 || (
            m.senderId === recipientId &&
            activeThread.slice(0, index).every(prior => prior.senderId === recipientId) &&
            Number.isFinite(latestTime) &&
            latestTime - new Date(m.createdAt).getTime() >= 0 &&
            latestTime - new Date(m.createdAt).getTime() <= 120_000
          )).slice(0, 4) : [];
        const previousTurns = activeThread.slice(incomingBatch.length, incomingBatch.length + 2);
        const peerHistory = recipientId === parsed.data.state.primaryCharacterId
          ? '' // The owner's existing Kindroid conversation already holds its own history.
          : previousTurns.reverse().map(m =>
              `${m.senderId === input.characterId ? actorName : recipientName}: ${describeDmMessage(m).slice(0, 450)}`).join('\n');
        const latestIncomingText = incomingBatch.slice().reverse().map(describeDmMessage).filter(Boolean).join('\n').slice(0, 3000);
        const peerContext = recipientId === parsed.data.state.primaryCharacterId
          ? '' // Do not inject a role-boundary lecture into the owner's natural Kin chat.
          : `[ECHO PRIVATE THREAD — ROLE BOUNDARY]\nYou are ${actorName}. You are writing a PRIVATE DM to ${recipientName}, not to ${ownerName} unless those names refer to the same person. The other participant in this thread is ${recipientName}. Any earlier Kindroid conversation with ${ownerName} or another contact is NOT the current conversation. Never address the account owner or narrate their actions unless they are the actual recipient. Use only this thread's messages as conversation history. Keep your established personality, voice and relationships. Write in English.\nRecent messages in this exact ECHO thread:\n${peerHistory || '(No previous messages)'}\n[END ECHO THREAD CONTEXT]\n`;
        // Reuse cached, access-controlled vision observations; never request a new
        // paid analysis just to generate an autonomous story reply.
        const storyVisual = storyForReply
          ? vision.analyses[`story:${storyForReply.id}:story:${storyForReply.id}`]
          : undefined;
        const visualContext = storyVisual
          ? `Cached visual observations (not identity verification): ${storyVisual.sceneDescription.slice(0,700)}. Visible activities: ${storyVisual.activities.slice(0,4).join('; ').slice(0,240)}. Notable details: ${storyVisual.notableDetails.slice(0,4).join('; ').slice(0,240)}. Uncertainties: ${storyVisual.uncertainty.slice(0,3).join('; ').slice(0,200)}.`
          : 'No verified visual description is available for this story. Do not claim to see specific objects, people, places or actions from the image.';
        const storyMentions = storyForReply
          ? (storyForReply.mentionedAccountIds ?? []).map(id => {
              const tagged = parsed.data.state.characters.find(c => c.id === id);
              return tagged ? `${tagged.name} (account ${id})` : id;
            }).slice(0, 10).join(', ')
          : '';
        const namedStorySubject = storyForReply && (storyForReply.mentionedAccountIds ?? []).length === 1
          ? parsed.data.state.characters.find(c => c.id === (storyForReply.mentionedAccountIds ?? [])[0])?.name
          : undefined;
        const storyMetadata = storyForReply
          ? `Media type: ${storyForReply.image ? 'PHOTO (still image, not video or clip)' : 'text-only story (no photo)'}. Tagged accounts: ${storyMentions || 'none'}. Tagged accounts are explicitly named people, but a tag alone does not prove a face's identity. ${namedStorySubject ? `The story explicitly tags ${namedStorySubject}. If the caption refers to a singular person being teased or photographed and the visual observations are consistent, understand that ${namedStorySubject} is the intended subject; refer to ${namedStorySubject} by name, not yourself. If visual evidence conflicts or multiple people make the subject ambiguous, distinguish the tag from what can be seen instead of asserting identity. ` : ''}`
          : '';
        let outgoingPrompt = peerContext + (storyForReply
          ? `[ECHO story reply: You (${actorName}) are viewing ${recipientName}'s story, not appearing in it. ${storyMetadata} Caption: ${(storyForReply.caption ?? '').slice(0,250)}. ${visualContext.slice(0,650)} Tags do not verify faces. Do not claim the photo is yours or invent details. Reply as yourself to ${recipientName}, naturally, with your usual narration and dialogue when appropriate; do not shorten your style.]`
          : isDirectReply
            ? (recipientId === parsed.data.state.primaryCharacterId
                ? latestIncomingText // Send the owner's actual message, not a fabricated ECHO instruction.
                : `[ECHO incoming private DM from ${recipientName}. Reply to ${recipientName}, not to another contact. Latest message:]\n${latestIncomingText}`)
            : `[ECHO autonomous DM: You have decided to reach out to ${recipientName} on your own. Write one natural message. Do not claim they messaged you or invent a reply from them.]`);
        // A profile card shared in this exact private thread grants a one-time
        // read of that profile's public posts; it does not create a follow.
        const sharedProfileIds = [...incomingBatch.flatMap(message => [...(message.text ?? '').matchAll(/\[ECHO_PROFILE:([a-zA-Z0-9_-]{1,120})\]/g)])]
          .map(match => match[1]).slice(0, 2);
        if (sharedProfileIds.length) {
          const sharedProfileContext: string[] = [];
          for (const profileId of sharedProfileIds) {
            const profile = parsed.data.state.characters.find(c => c.id === profileId && !c.archived);
            if (!profile || (profile.privateAccount && !(parsed.data.state.follows[input.characterId] ?? []).includes(profileId) && profileId !== input.characterId)) continue;
            const profilePosts = parsed.data.state.posts.filter(p => p.authorId === profileId)
              .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, 4);
            // A profile card is an explicit request to inspect this profile.
            // Analyze at most ONE recent image post per shared profile; reuse
            // persisted analyses for the rest. This bounds paid vision work.
            const firstImagePost = profilePosts.find(p => p.image && /^\/objects\/(?:uploads|r2)\/[a-f0-9-]{20,}$/i.test(p.image.split('?')[0]));
            if (firstImagePost) {
              const alreadyAnalyzed = await visionService.loadContext(ownerId, parsed.data.state,
                { ...input, postId: firstImagePost.id }, input.universeId ?? 'primary').catch(() => null);
              if (!alreadyAnalyzed?.postSummaries[firstImagePost.id]) {
                try {
                  await visionService.analyzePost(ownerId, parsed.data.state, firstImagePost.id, input.universeId ?? 'primary');
                } catch (error) {
                  console.warn('[kindroid] shared profile vision unavailable', { postId: firstImagePost.id,
                    code: error instanceof Error ? error.name : 'unknown' });
                }
              }
            }
            const observations: string[] = [];
            for (const item of profilePosts) {
              // Cached vision only. Never spend vision credits merely because a
              // user shared a profile, and never claim unseen image details.
              const cached = await visionService.loadContext(ownerId, parsed.data.state,
                { ...input, postId: item.id }, input.universeId ?? 'primary').catch(() => null);
              const summary = cached?.postSummaries[item.id];
              const mediaObservations = (item.media ?? []).map(media => cached?.analyses[`post:${item.id}:${media.id}`]?.sceneDescription)
                .filter((description): description is string => !!description).slice(0, 2);
              const visual = mediaObservations.length ? mediaObservations.join('; ').slice(0, 350)
                : summary ? JSON.stringify(summary).slice(0, 350)
                : 'Image content not analyzed; do not describe its appearance.';
              observations.push(`Caption: ${item.caption.slice(0, 240)} | Visual evidence: ${visual}`);
            }
            sharedProfileContext.push(`Profile @${profile.handle} (${profile.name}). Recent public posts:\n${observations.join('\n') || '(No published posts)'}`);
          }
          // Keep profile evidence compact; the upstream provider rejected a 4504-character DM request.
          if (sharedProfileContext.length) outgoingPrompt += `\n[ECHO SHARED PROFILE — read-only visit. You may discuss ONLY these verified posts and their cached visual descriptions. Following is OPTIONAL and has NOT occurred. Never claim to have followed or liked the account. If images were not analyzed, do not invent clothing, colors or faces. React naturally in your established personality.]\n${sharedProfileContext.join('\n').slice(0, 1100)}\n[END SHARED PROFILE]`;
        }
        // A character can inspect their own published ECHO stories even when they
        // have not viewed them. Keep this separate from other people's viewed stories.
        // Only attach it when the incoming message refers to a story, to protect
        // Kindroid's limited context budget and avoid irrelevant social leakage.
        const asksAboutStory = /\b(story|stories|status|historia|historias|subiste|publicaste)\b/i.test(newest?.text ?? '');
        if (asksAboutStory && !storyForReply) {
          const ownStories = parsed.data.state.stories
            .filter(st => st.authorId === input.characterId)
            .sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime())
            .slice(0, 3);
          if (ownStories.length) {
            const ownStoryContext = ownStories.map(st => {
              const tags = (st.mentionedAccountIds ?? []).map(id =>
                parsed.data.state.characters.find(ch => ch.id === id)?.name ?? id).slice(0, 4);
              return `Published ${st.createdAt}: ${st.image ? 'still photo' : 'text-only'}; caption: "${(st.caption ?? '').slice(0, 180)}"; tagged accounts: ${tags.join(', ') || 'none'}.`;
            }).join('\n');
            outgoingPrompt += `\n[ECHO OWN PROFILE — VERIFIED PUBLISHED STORIES: These are stories on YOUR (${actorName}) profile, not stories posted by the person messaging you. You can refer to their captions, media type and tagged accounts. Tags identify mentioned accounts, not visually verified faces. Do not invent unseen image details. If asked which story, distinguish the entries by caption and time.\n${ownStoryContext.slice(0, 650)}\n]`;
          }
        }
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
          const posts = (data.recentSocial?.posts ?? []).slice(-1).map(p =>
            `Post by ${(p.author?.name ?? 'Unknown').slice(0,60)}: ${(p.caption ?? '').slice(0,220)}${p.visionSummary ? ' | Image: '+p.visionSummary.slice(0,150):''}`);
          const comments = (data.recentSocial?.comments ?? []).slice(-1).map(m =>
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
            .slice(0,1)
            .map(x => `Older ECHO post (${new Date(x.p.createdAt).toISOString().slice(0,10)}) by ${(x.author?.name ?? 'Unknown').slice(0,60)}: ${x.p.caption.slice(0,260)}`) : [];
          // Stories are only remembered if this actor actually viewed them.
          // Never infer story viewing from a follow alone.
          const seenStories = visibleSeenStoriesForKindroid(freshState, input.characterId)
            .sort((a,b) => new Date(b.createdAt).getTime()-new Date(a.createdAt).getTime())
            .slice(0,1)
            .map(s => {
              const author = parsed.data.state.characters.find(ch => ch.id === s.authorId);
              return `Story actually viewed by this character, posted by ${(author?.name ?? 'Unknown').slice(0,60)}: ${s.caption.slice(0,200)}`;
            });
          // The shared context builder already ranks archived memories and
          // scopes private conversation memories to this exact DM recipient.
          const memories = (data.memory?.historicalRecalled ?? []).slice(0,1)
            .filter(m => kindroidMemoryAllowed(m, 'nela'))
            .map(m => `Earlier ECHO memory (${(m.kind ?? 'event').slice(0,32)}): ${(m.text ?? '').slice(0,350)}`);
          const journalFacts = await relevantWorldJournals(ownerId, input.universeId ?? 'primary', input.characterId, outgoingPrompt)
            .then(entries => entries.map(entry => `Known world journal (${entry.truthStatus}; ${entry.title}): ${entry.content}`))
            .catch(() => [] as string[]);
          const reservedJournalContext = journalFacts.join('\n').slice(0,400);
          const socialBudget = Math.max(0, 500 - reservedJournalContext.length - 1);
          const socialPart = [...posts,...comments,...older,...seenStories,...memories].join('\n').slice(0,socialBudget);
          socialContext = [reservedJournalContext,socialPart].filter(Boolean).join('\n');
        }
        // World knowledge is independent of the optional social-context toggle.
        // Restrict it to approved entries visible to this exact character.
        if (links.rows[0]?.social_context_enabled !== true) {
          const journalFacts = await relevantWorldJournals(ownerId, input.universeId ?? 'primary', input.characterId, outgoingPrompt)
            .catch(() => [] as Awaited<ReturnType<typeof relevantWorldJournals>>);
          socialContext = journalFacts.map(e => `Known world journal (${e.truthStatus}; ${e.title}): ${e.content}`).join('\n').slice(0,500);
        }
        selectedProvider = kindroidDmProvider(outgoingPrompt, kinId,
          // Only a story reply may require fresh visual/social context. Ordinary
          // DMs rely on Kindroid's own memory instead of replaying ECHO history.
          storyForReply ? socialContext : '', undefined, 'dm', input.characterId);
      }
      }
    }
  }
  // For the founder's linked characters, Kindroid chooses whether to view,
  // like or react to a visible story. Never substitute local random choices.
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
      input.situation === 'story_reaction' && !isolatedSocial) {
    const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    if (typeof kinId !== 'string' || !kinId) throw new EngineError('KINDROID_ONLY_NO_FALLBACK', 503);
    const story = parsed.data.state.stories.find(item => item.id === input.storyId);
    if (!story || !canCharacterViewCloseFriendsStory(parsed.data.state, story, input.characterId) ||
        !parsed.data.state.follows[input.characterId]?.includes(story.authorId)) {
      throw new EngineError('STORY_NOT_VISIBLE', 403);
    }
    const author = parsed.data.state.characters.find(item => item.id === story.authorId);
    const relation = actor?.configuration?.relationships?.find(item => item.targetId === story.authorId);
    selectedProvider = kindroidStoryDecisionProvider(kinId,
      `Author: ${(author?.name ?? 'someone').slice(0,80)}. Relationship: ${relation?.preset ?? 'unspecified'}. Caption: ${(story.caption ?? '').slice(0,500)}`, undefined, input.characterId);
  }
  // Founder: every like decision belongs to Kindroid, never a local automatic policy.
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
      (input.situation === 'like_post' || input.situation === 'like_comment') && !isolatedSocial) {
    const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    if (typeof kinId !== 'string' || !kinId) throw new EngineError('KINDROID_ONLY_NO_FALLBACK', 503);
    const post = input.postId ? parsed.data.state.posts.find(p => p.id === input.postId) : undefined;
    const comment = input.commentId ? parsed.data.state.comments.find(c => c.id === input.commentId) : undefined;
    // Image-only posts and emoji-only comments are legitimate social targets.
    // Do not invent a visual description when no cached vision was requested.
    if (!post && !comment) throw new EngineError('SOCIAL_TARGET_NOT_FOUND', 404);
    const visibleContext = [post?.caption?.trim() || (post ? 'Visible post with no caption (image contents unknown).' : ''),
      comment?.text?.trim() || ''].filter(Boolean).join('\n');
    selectedProvider = kindroidLikeDecisionProvider(kinId, input.situation, visibleContext, undefined, input.characterId);
  }
  // Keep the previous non-text policy only for other owners.
  if (dependencies.liveDmReply === true &&
      ownerId !== 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
      ['like_post', 'like_comment'].includes(input.situation)) {
    const situation = input.situation;
    selectedProvider = {
      name: 'echo-nontext-policy',
      async complete(request) {
        const decision = JSON.stringify({ action: 'like', situation, text: null,
          reaction: null, reason: 'Eligible non-text social action',
          suggestedDelayMinutes: 0, galleryPhotoId: null, contextSections: [] });
        request.validate?.(decision);
        return { text: decision, model: 'echo-nontext-policy', usage: unknownUsage(), attempts: [] };
      },
    };
  }
  // Founder universes: text actions are Kindroid-only. Never fall back when a
  // Kin link is missing, disabled, or Kindroid is unavailable. Non-text actions
  // (likes, story reactions, views) must remain eligible without a text model.
  if (dependencies.liveDmReply === true &&
      ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
      (input.situation === 'dm' || input.situation === 'comment' || input.situation === 'post' ||
       input.situation === 'story_reaction' || input.situation === 'like_post' || input.situation === 'like_comment')) {
    const linkCheck = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'}
      AND character_id = ${input.characterId} AND enabled = true LIMIT 1`);
    if (!linkCheck.rows.length || (!isolatedSocial && selectedProvider.name !== 'kindroid')) {
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
  const approvedJournals = isNonTextSocial ? [] as Awaited<ReturnType<typeof relevantWorldJournals>>
    : await relevantWorldJournals(ownerId, input.universeId ?? 'primary', input.characterId, journalQuery)
      .catch(() => [] as Awaited<ReturnType<typeof relevantWorldJournals>>);
  const journalContext = approvedJournals.map(e => `[${e.truthStatus}] ${e.title}: ${e.content}`).join('\n');
  return previewDecision(selectedProvider, parsed.data.state, input, snapshot.revision,
    new Date(), 'persisted_owner_universe', vision, historical, dependencies.liveDmReply ? 'live_dm_reply' : 'preview', language, galleryContext, dmPreferences, journalContext);
}
