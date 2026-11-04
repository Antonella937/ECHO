import type { Post, SocialState, StoryHighlight } from './types';

/** Legacy pins retain their original date-based presentation until reordered. */
export function getOrderedPinnedPosts(state: SocialState, actor: string): Post[] {
  const legacy = state.posts.filter(p => p.authorId === actor && p.pinned)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const fallback = new Map(legacy.map((p, i) => [p.id, i + 3]));
  return legacy.sort((a, b) => (a.pinOrder ?? fallback.get(a.id)!) - (b.pinOrder ?? fallback.get(b.id)!));
}

export function applyPinnedOrder(state: SocialState, actor: string, ids: string[]): SocialState {
  const ranks = new Map(ids.map((id, i) => [id, i]));
  return { ...state, posts: state.posts.map(p => {
    if (p.authorId !== actor) return p;
    if (ranks.has(p.id)) return { ...p, pinOrder: ranks.get(p.id) };
    if (p.pinOrder === undefined) return p;
    const { pinOrder: _, ...rest } = p;
    return rest;
  }) };
}

export function movePinnedPost(state: SocialState, id: string, actor: string, delta: -1 | 1): SocialState {
  const posts = getOrderedPinnedPosts(state, actor), index = posts.findIndex(p => p.id === id);
  if (index === -1) throw new Error('Solo la identidad autora puede ordenar sus publicaciones fijadas.');
  const target = index + delta;
  if (target < 0 || target >= posts.length) return state;
  [posts[index], posts[target]] = [posts[target], posts[index]];
  return applyPinnedOrder(state, actor, posts.map(p => p.id));
}

/** Keep stored legacy collection order, including on title/cover edits. */
export function getOrderedHighlights(state: SocialState, actor: string): StoryHighlight[] {
  const own = (state.highlights ?? []).filter(h => h.authorId === actor);
  const fallback = new Map(own.map((h, i) => [h.id, i + 200]));
  return own.sort((a, b) => (a.order ?? fallback.get(a.id)!) - (b.order ?? fallback.get(b.id)!));
}

export function applyHighlightOrder(state: SocialState, actor: string, ids: string[]): SocialState {
  const ranks = new Map(ids.map((id, i) => [id, i]));
  return { ...state, highlights: (state.highlights ?? []).map(h =>
    h.authorId === actor && ranks.has(h.id) ? { ...h, order: ranks.get(h.id) } : h) };
}

export function moveHighlight(state: SocialState, id: string, actor: string, delta: -1 | 1): SocialState {
  const highlights = getOrderedHighlights(state, actor), index = highlights.findIndex(h => h.id === id);
  if (index === -1) throw new Error('Solo la identidad autora puede ordenar sus destacadas.');
  const target = index + delta;
  if (target < 0 || target >= highlights.length) return state;
  [highlights[index], highlights[target]] = [highlights[target], highlights[index]];
  return applyHighlightOrder(state, actor, highlights.map(h => h.id));
}

/** Never use a cover outside this collection/identity, even on legacy data. */
export function highlightCover(state: SocialState, highlight: StoryHighlight, unavailable: readonly string[] = []) {
  const stories = state.stories.filter(s => highlight.storyIds.includes(s.id) &&
    s.authorId === highlight.authorId && !!s.image && !unavailable.includes(s.id));
  return stories.find(s => s.id === highlight.coverStoryId) ?? stories[0];
}
