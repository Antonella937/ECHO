import type { Character, Notification, Post, SocialReaction, SocialState, Story, StoryHighlight } from './types';
import { getOrderedPinnedPosts, applyPinnedOrder, getOrderedHighlights, applyHighlightOrder } from './social-ordering';
export { getOrderedPinnedPosts, movePinnedPost, getOrderedHighlights, moveHighlight, highlightCover } from './social-ordering';

export type PostEdit = Pick<Post, 'caption' | 'location'> & Pick<Partial<Post>, 'taggedAccountIds' | 'commentsEnabled'>;
export const isStoryActive = (s: Story, now = Date.now()) => {
  const age = now - Date.parse(s.createdAt);
  return age >= 0 && age < 24 * 60 * 60 * 1000;
};
export function mentionIds(text: string, accounts: Character[]): string[] {
  const handles = [...text.matchAll(/(?:^|[^a-zA-Z0-9_])@([a-zA-Z0-9_][a-zA-Z0-9_.]{0,29})/g)].map(m => m[1].replace(/\.+$/, '').toLowerCase());
  return accounts.filter(c => handles.includes(c.handle.toLowerCase())).map(c => c.id);
}
export function hashtags(text: string): string[] {
  return [...new Set([...text.matchAll(/(?:^|[^\p{L}\p{N}_])#([\p{L}\p{N}_]{1,80})/gu)].map(m => m[1].toLocaleLowerCase()))];
}
export function mentionNotifications(state: SocialState, text: string, actorId: string, ref: { postId?: string; storyId?: string }, tagged: string[] = []): SocialState {
  const recipients = [...new Set([...mentionIds(text, state.characters), ...tagged])].filter(id => id !== actorId);
  const entries: Notification[] = recipients.flatMap(recipientId => {
    const id = `mention:${ref.postId ?? ref.storyId}:${recipientId}`;
    if (state.notifications.some(n => n.id === id)) return [];
    return [{ id, recipientId, actorId, kind: 'mention' as const, postId: ref.postId ?? null, storyId: ref.storyId ?? null,
      commentId: null, excerpt: text.slice(0, 180), createdAt: new Date().toISOString(), read: false }];
  });
  return entries.length ? { ...state, notifications: [...entries, ...state.notifications] } : state;
}
export function editSocialPost(state: SocialState, id: string, actor: string, patch: Partial<PostEdit>, expected?: Partial<PostEdit>): SocialState {
  const post = state.posts.find(p => p.id === id);
  if (!post || post.authorId !== actor) throw new Error('Cambiá a la identidad autora para editar esta publicación.');
  const keys = Object.keys(patch) as (keyof PostEdit)[];
  for (const key of keys) {
    if (expected && JSON.stringify(post[key]) !== JSON.stringify(expected[key]) &&
      JSON.stringify(post[key]) !== JSON.stringify(patch[key]))
      throw new Error('La publicación cambió en otro dispositivo. Conservá tu borrador y volvé a abrirla.');
  }
  if (patch.caption !== undefined && patch.caption.length > 600) throw new Error('El pie de foto admite hasta 600 caracteres.');
  if (patch.location !== undefined && patch.location.length > 80) throw new Error('La ubicación admite hasta 80 caracteres.');
  if (patch.taggedAccountIds?.some(id => !state.characters.some(c => c.id === id))) throw new Error('La cuenta etiquetada no existe.');
  const edited = { ...post, ...patch, editedAt: new Date().toISOString() };
  return mentionNotifications({ ...state, posts: state.posts.map(p => p.id === id ? edited : p) }, edited.caption, actor, { postId: id }, edited.taggedAccountIds);
}
export function setPinnedPost(state: SocialState, id: string, actor: string, pinned: boolean): SocialState {
  const post = state.posts.find(p => p.id === id);
  if (!post || post.authorId !== actor) throw new Error('Solo la identidad autora puede fijar esta publicación.');
  if (pinned && !post.pinned && state.posts.filter(p => p.authorId === actor && p.pinned).length >= 3)
    throw new Error('Podés fijar hasta 3 publicaciones. Desfijá una primero.');
  if (!!post.pinned === pinned) return state;
  const ordered = getOrderedPinnedPosts(state, actor).filter(p => p.id !== id).map(p => p.id);
  if (pinned) ordered.push(id);
  return applyPinnedOrder({ ...state, posts: state.posts.map(p => p.id === id ? { ...p, pinned } : p) }, actor, ordered);
}
export function toggleReaction(reactions: SocialReaction[] = [], actorId: string, value: string): SocialReaction[] {
  if (!value.trim() || value.length > 32) throw new Error('Reacción inválida.');
  const existing = reactions.find(r => r.actorId === actorId);
  const rest = reactions.filter(r => r.actorId !== actorId);
  return existing?.value === value ? rest : [...rest, { id: actorId, actorId, value }];
}
export function saveHighlight(state: SocialState, actor: string, highlight: StoryHighlight, expected?: StoryHighlight): SocialState {
  if (highlight.authorId !== actor) throw new Error('La destacada debe pertenecer a la identidad activa.');
  const current = state.highlights?.find(h => h.id === highlight.id);
  // PostgreSQL JSONB can change object key order without changing any field.
  const snapshot = (h: StoryHighlight) => JSON.stringify([h.id, h.authorId, h.title, h.storyIds, h.order ?? null, h.coverStoryId ?? null]);
  if (current && (!expected || snapshot(current) !== snapshot(expected))) throw new Error('La destacada cambió. Volvé a abrirla antes de guardar.');
  if (!highlight.title.trim() || highlight.title.length > 40 || !highlight.storyIds.length ||
    highlight.storyIds.some(id => !state.stories.some(s => s.id === id && s.authorId === actor)))
    throw new Error('Elegí un título y al menos una historia propia.');
  const previous = getOrderedHighlights(state, actor).map(h => h.id);
  const ordered = previous.filter(id => id !== highlight.id);
  const position = highlight.order ?? (current ? previous.indexOf(highlight.id) : ordered.length);
  if (!Number.isInteger(position) || position < 0 || position > ordered.length)
    throw new Error('La posición de la destacada no es válida.');
  ordered.splice(position, 0, highlight.id);
  const saved = { ...highlight, storyIds: [...new Set(highlight.storyIds)],
    coverStoryId: highlight.coverStoryId && highlight.storyIds.includes(highlight.coverStoryId) ? highlight.coverStoryId : null };
  const next = current ? (state.highlights ?? []).map(h => h.id === highlight.id ? saved : h) : [...(state.highlights ?? []), saved];
  return applyHighlightOrder({ ...state, highlights: next }, actor, ordered);
}
export function groupNotifications(notifications: Notification[]) {
  const groups = new Map<string, Notification & { ids: string[]; actorIds: string[]; count: number }>();
  for (const n of [...notifications].sort((a, b) => b.createdAt.localeCompare(a.createdAt))) {
    const grouped = ['like', 'comment_like', 'comment', 'follow'].includes(n.kind);
    const key = grouped ? [n.recipientId, n.kind, n.postId, n.commentId, n.storyId, n.createdAt.slice(0, 10)].join(':') : n.id;
    const current = groups.get(key);
    if (!current) groups.set(key, { ...n, ids: [n.id], actorIds: [n.actorId], count: 1 });
    else {
      current.ids.push(n.id); current.actorIds = [...new Set([...current.actorIds, n.actorId])];
      current.count++; current.read = current.read && n.read;
    }
  }
  return [...groups.values()];
}
