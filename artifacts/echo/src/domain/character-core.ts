import type { CharacterConfiguration } from '@workspace/api-client-react';
import { SaveUniverseBody } from '@workspace/api-zod';
import type { Character, SocialState } from './types';

export type CharacterConfig = CharacterConfiguration;
const configurationSchema = SaveUniverseBody.shape.state.shape.characters.element.shape.configuration;
export function sameCharacterValue(a: unknown, b: unknown): boolean {
  const stable = (value: unknown): unknown => Array.isArray(value) ? value.map(stable) :
    value && typeof value === 'object' ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)).map(([key, v]) => [key, stable(v)])) : value;
  return JSON.stringify(stable(a)) === JSON.stringify(stable(b));
}
export const relationshipPresets = {
  stranger: 'Desconocidos', acquaintance: 'Conocidos', friend: 'Amigos', close_friend: 'Amigos cercanos / mejores amigos',
  family: 'Familia', crush: 'Crush', romantic_tension: 'Amigos con tensión romántica', partner: 'Pareja',
  ex: 'Ex', rival: 'Enemigos / rivales', custom: 'Personalizada',
} as const;

/** Lazy compatibility: opening a legacy profile never rewrites it. */
export function defaultCharacterConfig(character: Partial<Character> = {}): CharacterConfig {
  return {
    version: 1,
    basic: { name: character.name ?? '', age: null, pronouns: '', interests: [], likes: [], dislikes: [], notes: '' },
    personality: { description: '', traits: [], temperament: '', values: [], humor: '', sociability: 'medium', expressiveness: '', emotionalStyle: '', commonTopics: [], boundaries: [] },
    voice: { speakingStyle: '', messageLength: 'balanced', vocabulary: '', emojiStyle: '', captionStyle: '', commentStyle: '', disclosure: 'balanced', postsAbout: [], avoidsPosting: [] },
    relationships: [],
    routine: { timezone: 'America/Argentina/Buenos_Aires', flexibilityNotes: '', entries: [] },
    social: { activity: 'medium', postsFrequency: 'normal', storiesFrequency: 'normal', likesFrequency: 'normal',
      commentsFrequency: 'normal', initiatesDMs: 'normal', replySpeed: 'normal', sociability: 'medium', spontaneity: 'medium',
      allowSilence: true, silenceNotes: '', postsPerWeek: null, storiesPerWeek: null, minReplyMinutes: null, maxReplyMinutes: null },
    memory: { permanent: [], relationships: [], recent: [], recentLimit: 50, recentSummary: '' },
    currentState: { location: character.location ?? '', activity: '', mood: '', companions: [], lastActivityAt: null,
      nextEvent: '', source: 'manual', updatedAt: '1970-01-01T00:00:00.000Z' },
    assistance: { description: '', status: 'manual', provider: null },
  };
}
export function characterConfig(character: Character): CharacterConfig {
  return structuredClone(character.configuration ?? defaultCharacterConfig(character));
}
export function sectionStatus(character: Character, config: CharacterConfig): Record<string, boolean> {
  return { identity: Boolean(character.name && character.handle),
    personality: Boolean(config.personality.description || config.personality.traits.length || config.voice.speakingStyle),
    relationships: config.relationships.length > 0, routine: config.routine.entries.length > 0,
    social: !sameCharacterValue(config.social, defaultCharacterConfig().social),
    memory: config.memory.permanent.length + config.memory.relationships.length + config.memory.recent.length > 0 || !!config.memory.recentSummary,
    state: Boolean(config.currentState.activity || config.currentState.mood || config.currentState.lastActivityAt) };
}
export function validateCharacterConfig(config: CharacterConfig, state: SocialState, selfId?: string): void {
  const parsed = configurationSchema.safeParse(config);
  if (!parsed.success) {
    const issue = parsed.error.issues[0];
    throw Error(`Revisá ${issue.path.join(' / ')}: hay un valor fuera de rango o demasiado extenso.`);
  }
  try { new Intl.DateTimeFormat('es', { timeZone: config.routine.timezone }); } catch { throw Error('Elegí una zona horaria válida, por ejemplo America/Argentina/Buenos_Aires.'); }
  const validTarget = (id: string) => id === 'owner' || state.characters.some(c => c.id === id && id !== selfId);
  if (config.relationships.some(r => !validTarget(r.targetId))) throw Error('Una relación debe apuntar a vos o a otra cuenta de este universo.');
  if (new Set(config.relationships.map(r => r.targetId)).size !== config.relationships.length) throw Error('Usá una sola ficha de relación por persona.');
  if ([...config.memory.permanent, ...config.memory.relationships, ...config.memory.recent].some(m => m.targetId && !validTarget(m.targetId)))
    throw Error('El vínculo de un recuerdo ya no existe.');
  if (config.memory.relationships.some(m => !m.targetId)) throw Error('Elegí a quién corresponde cada recuerdo de vínculo.');
  if (config.currentState.companions.some(id => !validTarget(id))) throw Error('Hay una compañía que no pertenece a este universo.');
  for (const entry of config.routine.entries) {
    if (!entry.title.trim() || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.start) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(entry.end))
      throw Error('Cada actividad necesita nombre y horas válidas.');
    if (entry.recurrence === 'weekly' && !entry.weekdays.length) throw Error('Elegí al menos un día para cada actividad semanal.');
    if (entry.recurrence === 'once' && (!entry.date || !/^\d{4}-\d{2}-\d{2}$/.test(entry.date) || new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date))
      throw Error('Elegí una fecha válida para la actividad puntual.');
  }
  const { minReplyMinutes: min, maxReplyMinutes: max } = config.social;
  if (min != null && max != null && min > max) throw Error('La demora mínima no puede superar a la máxima.');
  for (const items of [config.relationships, config.routine.entries, config.memory.permanent, config.memory.relationships, config.memory.recent]) {
    if (new Set(items.map(i => i.id)).size !== items.length) throw Error('Hay elementos duplicados en la ficha.');
  }
  if (config.memory.recent.length > config.memory.recentLimit) throw Error('La memoria reciente supera el límite elegido: resumí o quitá recuerdos antes de reducirlo.');
}

/** A preview of probability/context, never a job scheduler or simulated activity. */
export function deriveRoutineContext(config: CharacterConfig, now = new Date()): Partial<CharacterConfig['currentState']> {
  const parts = new Intl.DateTimeFormat('en-CA', { timeZone: config.routine.timezone, year: 'numeric', month: '2-digit',
    day: '2-digit', hour: '2-digit', minute: '2-digit', hourCycle: 'h23' }).formatToParts(now);
  const part = (type: string) => parts.find(p => p.type === type)!.value;
  const date = `${part('year')}-${part('month')}-${part('day')}`;
  const midnight = Date.parse(`${date}T00:00:00Z`), minutes = Number(part('hour')) * 60 + Number(part('minute'));
  const time = (s: string) => Number(s.slice(0, 2)) * 60 + Number(s.slice(3));
  const matches = (entry: CharacterConfig['routine']['entries'][number], day: number) => {
    const d = new Date(midnight + day * 86400000);
    return entry.recurrence === 'once' ? entry.date === d.toISOString().slice(0, 10) : entry.weekdays.includes(d.getUTCDay() || 7);
  };
  const slots = config.routine.entries.flatMap(entry => {
    const days = entry.recurrence === 'once' && entry.date
      ? [Math.round((Date.parse(`${entry.date}T00:00:00Z`) - midnight) / 86400000)]
      : Array.from({ length: 9 }, (_, i) => i - 1);
    return days.filter(day => day >= -1 && matches(entry, day)).map(day => ({ entry, day, start: day * 1440 + time(entry.start),
      end: day * 1440 + time(entry.end) + (time(entry.end) <= time(entry.start) ? 1440 : 0) }));
  });
  const current = slots.find(s => s.start <= minutes && s.end > minutes);
  const next = slots.filter(s => s.start > minutes).sort((a, b) => a.start - b.start)[0];
  const nextEvent = next ? `${next.entry.title} · ${new Date(midnight + next.day * 86400000).toISOString().slice(0, 10)} ${next.entry.start} (${config.routine.timezone})` : '';
  return { activity: current?.entry.title ?? '', location: current?.entry.location ?? '', nextEvent, source: 'routine', updatedAt: now.toISOString() };
}

export function deletionBlockReason(state: SocialState, id: string): string | null {
  if (!state.characters.some(c => c.id === id)) return 'Esta cuenta ya no existe.';
  if (state.characters.filter(c => !c.archived && c.id !== id).length === 0) return 'Necesitás conservar al menos una identidad activa en el universo.';
  return null;
}

/** Permanently delete an identity and remove its references throughout the local universe. */
export function deleteUnusedAccount(state: SocialState, id: string): SocialState {
  const blocked = deletionBlockReason(state, id);
  if (blocked) throw Error(blocked);
  const characters = state.characters.filter(c => c.id !== id);
  const posts = state.posts.filter(p => p.authorId !== id).map(p => ({
    ...p, likes: p.likes.filter(x => x !== id), savedBy: p.savedBy.filter(x => x !== id),
    taggedAccountIds: p.taggedAccountIds?.filter(x => x !== id),
  }));
  const postIds = new Set(posts.map(p => p.id));
  const comments = state.comments.filter(c => c.authorId !== id && postIds.has(c.postId));
  const commentIds = new Set(comments.map(c => c.id));
  const stories = state.stories.filter(s => s.authorId !== id).map(s => ({
    ...s, seenBy: s.seenBy.filter(x => x !== id),
    mentionedAccountIds: s.mentionedAccountIds?.filter(x => x !== id),
    allowedViewerIds: s.allowedViewerIds?.filter(x => x !== id),
    likes: s.likes?.filter(x => x !== id),
    reactions: s.reactions?.filter(r => r.actorId !== id),
  }));
  const storyIds = new Set(stories.map(s => s.id));
  const follows = Object.fromEntries(Object.entries(state.follows)
    .filter(([key]) => key !== id).map(([key, ids]) => [key, ids.filter(x => x !== id)]));
  const closeFriends = state.closeFriends ? Object.fromEntries(Object.entries(state.closeFriends)
    .filter(([key]) => key !== id).map(([key, ids]) => [key, ids.filter(x => x !== id)])) : undefined;
  return {
    ...state, characters, posts, stories, follows, closeFriends,
    comments: comments.map(c => ({
      ...c, likes: c.likes.filter(x => x !== id),
      parentId: c.parentId && commentIds.has(c.parentId) ? c.parentId : null,
      replyToAuthorId: c.replyToAuthorId === id ? null : c.replyToAuthorId,
    })),
    messages: state.messages.filter(m => m.senderId !== id && m.recipientId !== id),
    notifications: state.notifications.filter(n => n.actorId !== id && n.recipientId !== id &&
      (!n.postId || postIds.has(n.postId)) && (!n.commentId || commentIds.has(n.commentId)) &&
      (!n.storyId || storyIds.has(n.storyId))),
    currentCharacterId: state.currentCharacterId === id ? characters.find(c => !c.archived)!.id : state.currentCharacterId,
  };
}
export function duplicateCharacter(state: SocialState, id: string, newId: string): Character {
  const original = state.characters.find(c => c.id === id);
  if (!original) throw Error('La cuenta original ya no existe.');
  const config = characterConfig(original);
  config.memory.recent = []; config.memory.recentSummary = '';
  config.currentState = defaultCharacterConfig(original).currentState;
  let n = 1, handle: string;
  do { handle = `${original.handle.slice(0, 22)}_copia${n++}`; } while (state.characters.some(c => c.handle === handle));
  return { ...structuredClone(original), id: newId, name: `${original.name.slice(0, 73)} (copia)`, handle,
    configuration: config, verified: false, archived: false, displayMetrics: { followers: null, following: null },
    providerRef: defaultProvider(), identity: { ...original.identity, referenceImages: [], appearance: '', styleNotes: '' } };
}
function defaultProvider(): Character['providerRef'] { return { provider: 'mock', externalId: null, status: 'not_connected', lastSyncAt: null }; }
