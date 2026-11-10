import { canCharacterViewCloseFriendsStory } from "../lib/storySharePolicy";
import type { CharacterDecisionInput, SocialState } from '@workspace/api-zod';
import { createHash } from 'node:crypto';
import { EngineError, sections } from './contracts';
import type { VisionContext, VisionEntityType } from '../vision/contracts';

export type HistoricalRecall = { memoryId: string; sourceId: string | null; kind: string; targetId: string | null; content: string; occurredAt: Date };

const noVision: VisionContext = { analyses: {}, postSummaries: {} };
const visionKey = (entityType: VisionEntityType, entityId: string, mediaId: string) =>
  `${entityType}:${entityId}:${mediaId}`;

/** Builds text-only context from an already owner-scoped persisted snapshot.
 * Never includes file URLs/bytes, provider IDs, credentials or unrelated DMs.
 */
export function buildCharacterContext(state: SocialState, input: CharacterDecisionInput, now = new Date(), vision: VisionContext = noVision, historical: HistoricalRecall[] = []) {
  const actor = state.characters.find(c => c.id === input.characterId && !c.archived);
  if (!actor) throw new EngineError('CHARACTER_NOT_FOUND', 404);
  const post = input.postId ? state.posts.find(p => p.id === input.postId) : undefined;
  const comment = input.commentId ? state.comments.find(c => c.id === input.commentId) : undefined;
  const story = input.storyId ? state.stories.find(s => s.id === input.storyId) : undefined;
  const message = input.messageId ? state.messages.find(m => m.id === input.messageId) : undefined;
  const recipient = input.recipientId ? state.characters.find(c => c.id === input.recipientId && !c.archived) : undefined;
  // Linked-account fields are present in newer persisted universes but may not
  // yet appear in the generated OpenAPI Character type.
  const personIdOf = (character: typeof actor): string => {
    const value = (character as typeof actor & { personId?: unknown }).personId;
    return typeof value === "string" && value.length > 0 ? value : character.id;
  };
  const accountContextOf = (character: typeof actor): string => {
    const value = (character as typeof actor & { accountContext?: unknown }).accountContext;
    return typeof value === "string" ? value : "";
  };
  const has = (key: keyof Pick<CharacterDecisionInput, 'postId' | 'commentId' | 'recipientId' | 'storyId' | 'messageId'>) => Boolean(input[key]);
  const targetFields = ['postId', 'commentId', 'recipientId', 'storyId', 'messageId'] as const;
  const rejectUnexpected = (...allowed: typeof targetFields[number][]) => {
    if (targetFields.some(key => has(key) && !allowed.includes(key))) throw new EngineError('INVALID_SOCIAL_TARGET');
  };
  switch (input.situation) {
    case 'post':
      rejectUnexpected();
      break;
    case 'comment':
      rejectUnexpected('postId', 'commentId');
      if (!post || post.commentsEnabled === false ||
        (!!input.commentId && (!comment || comment.postId !== post.id || comment.authorId === actor.id))) {
        throw new EngineError('INVALID_POST_TARGET');
      }
      break;
    case 'dm':
      rejectUnexpected('recipientId', 'storyId');
      if (!recipient || personIdOf(recipient) === personIdOf(actor) || (input.storyId && (!story || story.authorId !== recipient.id || !state.follows[actor.id]?.includes(story.authorId) || !canCharacterViewCloseFriendsStory(state, story, actor.id)))) throw new EngineError('INVALID_DM_TARGET');
      break;
    case 'like_post':
      rejectUnexpected('postId');
      if (!post || post.authorId === actor.id || post.likes.includes(actor.id)) throw new EngineError('INVALID_LIKE_TARGET');
      break;
    case 'like_comment':
      rejectUnexpected('postId', 'commentId');
      if (!post || !comment || comment.postId !== post.id || comment.authorId === actor.id || comment.likes.includes(actor.id)) {
        throw new EngineError('INVALID_LIKE_TARGET');
      }
      break;
    case 'story_reaction': {
      rejectUnexpected('storyId');
      const createdAt = story ? new Date(story.createdAt).getTime() : NaN;
      if (!story || story.authorId === actor.id || !story.caption.trim() ||
        !story.seenBy.includes(actor.id) || story.reactions?.some(reaction => reaction.actorId === actor.id) ||
        !Number.isFinite(createdAt) || createdAt > now.getTime() || now.getTime() - createdAt >= 24 * 60 * 60_000) {
        throw new EngineError('INVALID_STORY_TARGET');
      }
      break;
    }
    case 'dm_reaction':
      rejectUnexpected('messageId');
      if (!message || message.senderId === actor.id || message.recipientId !== actor.id ||
        message.hiddenForIds?.includes(actor.id) || !message.text.trim() ||
        message.reactions?.some(reaction => reaction.actorId === actor.id)) {
        throw new EngineError('INVALID_DM_REACTION_TARGET');
      }
      break;
  }
  if (input.situation === 'dm_reaction' && message &&
    (message.senderId === actor.id || message.recipientId !== actor.id)) {
    throw new EngineError('INVALID_DM_REACTION_TARGET');
  }
  // Linked accounts share one canonical persona configuration, but retain separate
  // social audiences, galleries, threads and publication history.
  const personId = personIdOf(actor);
  const personAccounts = state.characters.filter(candidate =>
    personIdOf(candidate) === personId && !candidate.archived);
  const canonical = personAccounts.find(candidate => candidate.id === personId) ?? actor;
  const c = canonical.configuration ?? actor.configuration;
  const warnings: string[] = [];
  let truncated = false;
  function bounded(value: unknown, depth = 0): unknown {
    if (value instanceof Date) return value.toISOString();
    if (typeof value === 'string') {
      if (value.length > 6000) truncated = true;
      return value.slice(0, 6000);
    }
    if (Array.isArray(value)) {
      if (value.length > 30) truncated = true;
      return value.slice(0, 30).map(v => bounded(v, depth + 1));
    }
    if (value && typeof value === 'object') {
      if (depth > 12) throw new EngineError('CONTEXT_TOO_DEEP');
      return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, bounded(v, depth + 1)]));
    }
    return value ?? null;
  }
  const identityOf = (id: string) => {
    if (id === 'owner') return { id, role: 'universe_owner_not_active_character' };
    const person = state.characters.find(p => p.id === id);
    return person ? { id, name: person.name, handle: person.handle } : { id, unavailable: true };
  };
  const postText = (p: SocialState['posts'][number]) => ({
    id: p.id, author: identityOf(p.authorId), caption: p.caption, location: p.location,
    createdAt: p.createdAt, commentsEnabled: p.commentsEnabled !== false,
    likesCount: p.likes?.length ?? 0,
    commentsCount: state.comments.filter(item => item.postId === p.id).length,
    taggedAccounts: (p.taggedAccountIds ?? []).map(identityOf),
    media: (p.media?.length ? p.media : (p.image ? [{ id: `${p.id}:legacy`, type: 'image' as const }] : []))
      .map((m, i) => {
        const mediaVision = vision.analyses[visionKey('post', p.id, m.id)];
        return { id: m.id, position: i + 1, type: m.type, visionAnalysis: mediaVision ?? null, contentNotAnalyzed: !mediaVision };
      }),
    visionSummary: vision.postSummaries[p.id] ?? null,
  });
  const latest = <T extends { createdAt: Date }>(items: T[], n: number) =>
    [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, n).reverse();
  // Narrative continuity includes the recent feed of characters this actor actually
  // follows or knows, not just their own posts and explicit tags. This stays inside
  // the owner-scoped universe and never broadens private DM visibility.
  const knownAuthors = new Set([
    ...(state.follows[actor.id] ?? []),
    ...(c?.relationships ?? []).map(r => r.targetId).filter(id => id !== 'owner'),
  ]);
  const relevantPosts = latest(state.posts.filter(p =>
    p.authorId === actor.id || knownAuthors.has(p.authorId) ||
    p.taggedAccountIds?.includes(actor.id) || p.id === post?.id), 6);
  const relevantIds = new Set(relevantPosts.map(p => p.id));
  const dmTargetId = input.situation === 'dm'
    ? recipient!.id
    : input.situation === 'dm_reaction' && message ? message.senderId : undefined;
  // Conversation continuity across aliases is available only inside the same
  // correspondent's DM. It never joins the visible inboxes or public context.
  const otherAliasIds = new Set(personAccounts.map(account => account.id).filter(id => id !== actor.id));
  const aliasConversation = dmTargetId ? latest(state.messages.filter(m =>
    !m.hiddenForIds?.includes(actor.id) &&
    !personAccounts.some(account => account.id !== actor.id && m.hiddenForIds?.includes(account.id)) &&
    ((otherAliasIds.has(m.senderId) && m.recipientId === dmTargetId) ||
     (otherAliasIds.has(m.recipientId) && m.senderId === dmTargetId))), 8) : [];
  const messages = dmTargetId ? latest(state.messages.filter(m =>
    !m.hiddenForIds?.includes(actor.id) &&
    ((m.senderId === actor.id && m.recipientId === dmTargetId) || (m.recipientId === actor.id && m.senderId === dmTargetId))), 10) : [];
  // Keep the most recent entries and recover older, explicitly recorded memories
  // only when their text matches the current social situation. This is a pure,
  // deterministic retrieval step: no model calls, mutations, or invented facts.
  const memoryQuery = [
    post?.caption, comment?.text, story?.caption, message?.text,
    ...messages.slice(-3).map(item => item.text),
  ].filter((value): value is string => !!value?.trim()).join(' ').toLocaleLowerCase();
  const queryTerms = new Set((memoryQuery.match(/[\p{L}\p{N}]{4,}/gu) ?? [])
    .filter(term => !['para', 'como', 'esta', 'este', 'pero', 'sobre', 'porque'].includes(term)));
  const memoryRecent = c?.memory.recent ?? [];
  const chronological = latest(memoryRecent, 10);
  const chronologicalIds = new Set(chronological.map(item => item.id));
  const recalled = queryTerms.size ? memoryRecent
    .filter(item => !chronologicalIds.has(item.id))
    .map(item => ({
      item,
      score: (item.text.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
        .filter(term => queryTerms.has(term)).length,
    }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score ||
      new Date(b.item.createdAt).getTime() - new Date(a.item.createdAt).getTime())
    .slice(0, 3).map(entry => entry.item) : [];
  // Archive entries are already owner/universe/character scoped by the server.
  // Never surface private conversation memories in a different DM or public context.
  const historicalRecalled = queryTerms.size ? historical
    .filter(item => item.kind !== 'conversation' || (!!dmTargetId && item.targetId === dmTargetId))
    .map(item => ({ item, score: (item.content.toLocaleLowerCase().match(/[\p{L}\p{N}]{4,}/gu) ?? [])
      .filter(term => queryTerms.has(term)).length }))
    .filter(entry => entry.score > 0)
    .sort((a, b) => b.score - a.score || b.item.occurredAt.getTime() - a.item.occurredAt.getTime())
    .slice(0, 3).map(entry => ({ sourceId: entry.item.sourceId, kind: entry.item.kind,
      targetId: entry.item.targetId, text: entry.item.content.slice(0, 400), createdAt: entry.item.occurredAt })) : [];
  // Recall both sent and received transcribed voice notes from this exact DM, even after they
  // leave the last-ten-message window. The original attachment stays private;
  // only its user-reviewed transcript (already persisted as message text) is used.
  const olderVoiceNotes = dmTargetId ? state.messages
    .filter(m => ((m.recipientId === actor.id && m.senderId === dmTargetId) ||
      (m.senderId === actor.id && m.recipientId === dmTargetId)) &&
      !m.hiddenForIds?.includes(actor.id) &&
      m.attachments?.some(a => a.type === 'audio') &&
      m.text.includes('[Transcripción de nota de voz]:') &&
      !messages.some(recent => recent.id === m.id))
    .map(m => {
      const transcript = m.text.split('[Transcripción de nota de voz]:').slice(1).join(' ').trim();
      const terms = transcript.toLocaleLowerCase().match(/[\\p{L}\\p{N}]{4,}/gu) ?? [];
      const score = terms.filter(term => queryTerms.has(term)).length;
      return { message: m, transcript, score };
    })
    .filter(entry => entry.transcript && entry.score > 0)
    .sort((a, b) => b.score - a.score ||
      new Date(b.message.createdAt).getTime() - new Date(a.message.createdAt).getTime())
    .slice(0, 3)
    .map(entry => ({ sourceId: entry.message.id, text: entry.transcript.slice(0, 1000),
      createdAt: entry.message.createdAt })) : [];
  // Relationship evolution begins with verifiable, actor-visible interaction
  // evidence, not guessed affection or automatic changes to trust/closeness.
  const relationshipEvidence = (c?.relationships ?? []).map(relationship => {
    const targetId = relationship.targetId;
    const sharedMessages = state.messages.filter(m =>
      !m.hiddenForIds?.includes(actor.id) &&
      ((m.senderId === actor.id && m.recipientId === targetId) ||
       (m.recipientId === actor.id && m.senderId === targetId)));
    const sharedComments = state.comments.filter(m => {
      const p = state.posts.find(post => post.id === m.postId);
      return (m.authorId === actor.id && p?.authorId === targetId) ||
        (m.authorId === targetId && p?.authorId === actor.id);
    });
    const visibleEvents = [
      ...sharedMessages.map(m => ({ id: m.id, at: m.createdAt, kind: 'dm' })),
      ...sharedComments.map(m => ({ id: m.id, at: m.createdAt, kind: 'comment' })),
    ].sort((a, b) => new Date(b.at).getTime() - new Date(a.at).getTime());
    // A cautious, reversible suggestion only: reciprocal contact on separate
    // days can indicate familiarity, never trust, attraction or a new preset.
    const cutoff = now.getTime() - 30 * 24 * 60 * 60_000;
    const recentMessages = sharedMessages.filter(m => {
      const at = new Date(m.createdAt).getTime();
      return Number.isFinite(at) && at >= cutoff && at <= now.getTime();
    });
    const distinctDays = new Set(recentMessages.map(m => new Date(m.createdAt).toISOString().slice(0, 10))).size;
    const sent = recentMessages.filter(m => m.senderId === actor.id).length;
    const received = recentMessages.filter(m => m.senderId === targetId).length;
    const reciprocal = sent >= 3 && received >= 3 && distinctDays >= 3;
    const suggestedClosenessDelta = reciprocal ? 1 : 0;
    return { target: identityOf(targetId),
      dmCount: sharedMessages.length, commentCount: sharedComments.length,
      latestInteractions: visibleEvents.slice(0, 5),
      progression: { periodDays: 30, distinctConversationDays: distinctDays,
        messagesSent: sent, messagesReceived: received, reciprocal,
        suggestedClosenessDelta, applied: false,
        reason: reciprocal ? 'sustained_reciprocal_contact' : 'insufficient_reciprocal_evidence',
        trustDelta: 0, attractionDelta: 0, tensionDelta: 0,
        presetChange: false },
      interpretation: 'contact_is_not_proof_of_affection_or_trust',
      relationshipScoresChanged: false };
  });
  const data = {
    identity: { id: actor.id, name: actor.name, handle: actor.handle, bio: actor.bio, occupation: actor.occupation, location: actor.location,
      accountType: actor.accountType ?? 'personal', basic: c?.basic ?? null,
      sharedPersonId: personId, accountContext: accountContextOf(actor),
      linkedAccounts: personAccounts.map(account => ({ id: account.id, handle: account.handle, accountType: account.accountType ?? 'personal' })),
      accountBoundary: 'One person across accounts. Never assume followers know aliases; never cross-post gallery assets or disclose private identity without context. Shared memories are not instructions to mention them.' },
    personality: c?.personality ?? null,
    voice: c?.voice ?? null,
    relationships: c?.relationships.map(r => ({ ...r, target: identityOf(r.targetId) })) ?? null,
    relationshipEvidence: c ? relationshipEvidence : null,
    routine: c ? { ...c.routine, localNow: localTime(now, c.routine.timezone), interpretation: 'probabilistic_context_not_commands' } : null,
    social: c?.social ?? null,
    memory: c ? { permanent: c.memory.permanent, relationships: c.memory.relationships,
      recent: chronological, recalled, historicalRecalled, olderVoiceNotes, recentSummary: c.memory.recentSummary,
      aliasConversationRecall: aliasConversation.map(m => ({
        from: identityOf(m.senderId), to: identityOf(m.recipientId),
        text: m.text.slice(0, 600), createdAt: m.createdAt,
      })),
      aliasRecallRule: 'These are private recollections of the same person from another account with this correspondent. Do not assume the correspondent knows the accounts are linked. Never reveal the alias or quote private messages automatically.' } : null,
    currentState: c ? { ...c.currentState, companions: c.currentState.companions.map(identityOf), provenance: 'manual_or_routine_not_observed_autonomy' } : null,
    recentSocial: {
      posts: relevantPosts.map(postText),
      comments: latest(state.comments.filter(m => m.authorId === actor.id || relevantIds.has(m.postId)), 10).map(m =>
        ({ id: m.id, postId: m.postId, author: identityOf(m.authorId), text: m.text, parentId: m.parentId,
          likesCount: m.likes.length, createdAt: m.createdAt })),
      stories: latest(state.stories.filter(s => s.authorId === actor.id || s.mentionedAccountIds?.includes(actor.id) || s.id === story?.id), 4).map(s =>
        ({ id: s.id, author: identityOf(s.authorId), caption: s.caption, createdAt: s.createdAt,
          reactions: (s.reactions ?? []).map(reaction => ({ author: identityOf(reaction.actorId), value: reaction.value })),
          visionAnalysis: vision.analyses[visionKey('story', s.id, `story:${s.id}`)] ?? null,
          mediaNotAnalyzed: !vision.analyses[visionKey('story', s.id, `story:${s.id}`)] })),
      messages: messages.map(m => ({ id: m.id, from: identityOf(m.senderId), to: identityOf(m.recipientId), text: m.text,
        createdAt: m.createdAt, quoteMessageId: m.quoteMessageId ?? null,
        reactions: (m.reactions ?? []).map(reaction => ({ author: identityOf(reaction.actorId), value: reaction.value })),
        attachments: m.attachments?.map(a => ({ type: a.type, contentNotAnalyzed: true })) ?? [] })),
    },
  };
  if (!c) warnings.push('CHARACTER_CONFIGURATION_MISSING: only real profile and available social context supplied');
  const availableSections = sections.filter(key => data[key] !== null);
  const target = post
    ? { post: postText(post), replyTo: comment ? { author: identityOf(comment.authorId), text: comment.text, parentId: comment.parentId } : null }
    : story ? { story: { id: story.id, author: identityOf(story.authorId), caption: story.caption, createdAt: story.createdAt,
      reactions: (story.reactions ?? []).map(reaction => ({ author: identityOf(reaction.actorId), value: reaction.value })),
      visionAnalysis: vision.analyses[visionKey('story', story.id, `story:${story.id}`)] ?? null,
      mediaNotAnalyzed: !vision.analyses[visionKey('story', story.id, `story:${story.id}`)] } }
      : message ? { message: { id: message.id, from: identityOf(message.senderId), text: message.text,
        createdAt: message.createdAt,
        reactions: (message.reactions ?? []).map(reaction => ({ author: identityOf(reaction.actorId), value: reaction.value })),
        attachmentsNotAnalyzed: (message.attachments ?? []).map(a => a.type) } }
        : recipient ? identityOf(recipient.id) : null;
  const context = bounded({ now: now.toISOString(), situation: input.situation, target,
    ...data });
  const serialized = JSON.stringify(context);
  if (serialized.length > 60000) throw new EngineError('CONTEXT_BUDGET_EXCEEDED');
  if (truncated) warnings.push('CONTEXT_TRUNCATED: long fields or arrays were bounded for this preview');
  const actual = context as typeof data;
  const content = {
    identity: true,
    personality: !!c && !!(c.personality.description.trim() || c.personality.traits.length || c.personality.values.length || c.personality.boundaries.length),
    voice: !!c && !!(c.voice.speakingStyle.trim() || c.voice.vocabulary.trim() || c.voice.captionStyle.trim() || c.voice.commentStyle.trim()),
    relationships: !!actual.relationships?.length,
    routine: !!actual.routine?.entries.length,
    social: !!actual.social,
    memory: !!actual.memory && !!(actual.memory.permanent.length || actual.memory.relationships.length || actual.memory.recent.length || actual.memory.recentSummary.trim()),
    currentState: !!c && !!(c.currentState.location.trim() || c.currentState.activity.trim() || c.currentState.mood.trim() || c.currentState.companions.length || c.currentState.nextEvent.trim()),
    recentSocial: Object.values(actual.recentSocial).some(items => items.length > 0),
  };
  if (c && !content.personality) warnings.push('PERSONALITY_NOT_CONFIGURED: persisted defaults are not a developed personality');
  const auditSections = Object.entries(content).map(([name, hasContent]) => {
    const value = actual[name as keyof typeof data];
    const recordCount = name === 'memory'
      ? actual.memory ? actual.memory.permanent.length + actual.memory.relationships.length + actual.memory.recent.length : 0
      : name === 'routine' ? actual.routine?.entries.length ?? 0
      : name === 'recentSocial' ? Object.values(actual.recentSocial).reduce((n, items) => n + items.length, 0)
      : Array.isArray(value) ? value.length : value === null ? 0 : 1;
    return { name, hasContent, recordCount, fields: fieldPaths(value) };
  });
  return {
    serialized, availableSections: [...availableSections], warnings,
    audit: {
      contextHash: createHash('sha256').update(serialized).digest('hex'),
      sections: auditSections,
      recentCounts: Object.fromEntries(Object.entries(actual.recentSocial).map(([key, value]) => [key, value.length])),
      privateDmScope: input.situation === 'dm' || input.situation === 'dm_reaction' ? 'actor_and_recipient_only' as const : 'none' as const,
      visionMediaIncluded: Object.keys(vision.analyses).length,
      visionPostSummariesIncluded: Object.keys(vision.postSummaries).length,
    },
  };
}

function fieldPaths(value: unknown, prefix = ''): string[] {
  if (value === null || value === undefined || value === '') return [];
  if (value instanceof Date || typeof value !== 'object') return prefix ? [prefix] : [];
  if (Array.isArray(value)) return [...new Set(value.flatMap(v => fieldPaths(v, `${prefix}[]`)))];
  return Object.entries(value).flatMap(([key, v]) => fieldPaths(v, prefix ? `${prefix}.${key}` : key));
}

function localTime(now: Date, timezone: string) {
  try {
    return new Intl.DateTimeFormat('sv-SE', { timeZone: timezone, dateStyle: 'full', timeStyle: 'short' }).format(now);
  } catch { throw new EngineError('INVALID_CHARACTER_TIMEZONE'); }
}
