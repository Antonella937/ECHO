import type { CharacterDecisionInput, SocialState } from '@workspace/api-zod';
import { createHash } from 'node:crypto';
import { EngineError, sections } from './contracts';

/** Builds text-only context from an already owner-scoped persisted snapshot.
 * Never includes file URLs/bytes, provider IDs, credentials or unrelated DMs.
 */
export function buildCharacterContext(state: SocialState, input: CharacterDecisionInput, now = new Date()) {
  const actor = state.characters.find(c => c.id === input.characterId && !c.archived);
  if (!actor) throw new EngineError('CHARACTER_NOT_FOUND', 404);
  const post = input.postId ? state.posts.find(p => p.id === input.postId) : undefined;
  const comment = input.commentId ? state.comments.find(c => c.id === input.commentId) : undefined;
  const recipient = input.recipientId ? state.characters.find(c => c.id === input.recipientId && !c.archived) : undefined;
  if (input.situation === 'comment'
    ? !post || post.commentsEnabled === false || (!!input.commentId && (!comment || comment.postId !== post.id || comment.authorId === actor.id))
    : !!input.postId || !!input.commentId)
    throw new EngineError('INVALID_POST_TARGET');
  if (input.situation === 'dm' ? !recipient || recipient.id === actor.id : !!input.recipientId)
    throw new EngineError('INVALID_DM_TARGET');
  const c = actor.configuration;
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
    // Metadata only. A model must never pretend to see or hear these.
    media: (p.media ?? [{ id: `${p.id}:legacy`, type: 'image' }]).map((m, i) => ({ id: m.id, position: i + 1, type: m.type, contentNotAnalyzed: true })),
  });
  const latest = <T extends { createdAt: Date }>(items: T[], n: number) =>
    [...items].sort((a, b) => new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()).slice(0, n).reverse();
  const relevantPosts = latest(state.posts.filter(p => p.authorId === actor.id || p.taggedAccountIds?.includes(actor.id) || p.id === post?.id), 6);
  const relevantIds = new Set(relevantPosts.map(p => p.id));
  const messages = input.situation === 'dm' ? latest(state.messages.filter(m =>
    !m.hiddenForIds?.includes(actor.id) &&
    ((m.senderId === actor.id && m.recipientId === recipient!.id) || (m.recipientId === actor.id && m.senderId === recipient!.id))), 10) : [];
  const data = {
    identity: { id: actor.id, name: actor.name, handle: actor.handle, bio: actor.bio, occupation: actor.occupation, location: actor.location,
      accountType: actor.accountType ?? 'personal', basic: c?.basic ?? null },
    personality: c?.personality ?? null,
    voice: c?.voice ?? null,
    relationships: c?.relationships.map(r => ({ ...r, target: identityOf(r.targetId) })) ?? null,
    routine: c ? { ...c.routine, localNow: localTime(now, c.routine.timezone), interpretation: 'probabilistic_context_not_commands' } : null,
    social: c?.social ?? null,
    memory: c ? { permanent: c.memory.permanent, relationships: c.memory.relationships,
      recent: latest(c.memory.recent, 10), recentSummary: c.memory.recentSummary } : null,
    currentState: c ? { ...c.currentState, companions: c.currentState.companions.map(identityOf), provenance: 'manual_or_routine_not_observed_autonomy' } : null,
    recentSocial: {
      posts: relevantPosts.map(postText),
      comments: latest(state.comments.filter(m => m.authorId === actor.id || relevantIds.has(m.postId)), 10).map(m =>
        ({ id: m.id, postId: m.postId, author: identityOf(m.authorId), text: m.text, parentId: m.parentId, createdAt: m.createdAt })),
      stories: latest(state.stories.filter(s => s.authorId === actor.id || s.mentionedAccountIds?.includes(actor.id)), 4).map(s =>
        ({ id: s.id, author: identityOf(s.authorId), caption: s.caption, createdAt: s.createdAt, mediaNotAnalyzed: true })),
      messages: messages.map(m => ({ id: m.id, from: identityOf(m.senderId), to: identityOf(m.recipientId), text: m.text,
        createdAt: m.createdAt, quoteMessageId: m.quoteMessageId ?? null,
        attachments: m.attachments?.map(a => ({ type: a.type, contentNotAnalyzed: true })) ?? [] })),
    },
  };
  if (!c) warnings.push('CHARACTER_CONFIGURATION_MISSING: only real profile and available social context supplied');
  const availableSections = sections.filter(key => data[key] !== null);
  const context = bounded({ now: now.toISOString(), situation: input.situation,
    target: post
      ? { post: postText(post), replyTo: comment ? { author: identityOf(comment.authorId), text: comment.text, parentId: comment.parentId } : null }
      : recipient ? identityOf(recipient.id) : null,
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
      privateDmScope: input.situation === 'dm' ? 'actor_and_recipient_only' as const : 'none' as const,
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
