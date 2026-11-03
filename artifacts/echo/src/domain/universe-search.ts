import type { SocialState } from './types';
import { hashtags } from './social-features';

export function normalizeSearch(value: string): string {
  return value.normalize('NFD').replace(/\p{M}/gu, '').toLocaleLowerCase('es').replace(/\s+/g, ' ').trim();
}

export function searchHref(query = '', location = ''): string {
  const params = new URLSearchParams();
  if (query) params.set('q', query);
  if (location) params.set('location', location);
  return `/search${params.size ? `?${params}` : ''}`;
}

/** Only the supplied active-universe snapshot is searched; no global cache or API. */
export function searchUniverse(state: Pick<SocialState, 'characters' | 'posts'>, query = '', location = '') {
  const terms = normalizeSearch(query).replace(/(^|\s)[@#]/g, '$1').split(' ').filter(Boolean);
  const place = normalizeSearch(location);
  const matches = (value: string) => terms.every(term => normalizeSearch(value).includes(term));
  const active = terms.length > 0 || place.length > 0;
  if (!active) return { active, characters: [], posts: [], tags: [] };

  const authors = new Map(state.characters.map(character => [character.id, character]));
  const scopedPosts = state.posts.filter(post => authors.has(post.authorId) &&
    (!place || normalizeSearch(post.location) === place));
  const characters = place ? [] : state.characters.filter(character => !character.archived &&
    matches(`${character.name} ${character.handle} ${character.bio} ${character.occupation} ${character.location}`));
  const posts = scopedPosts.filter(post => {
    const author = authors.get(post.authorId)!;
    return matches(`${post.caption} ${post.location} ${author.name} ${author.handle}`);
  }).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  const tags = [...new Set(scopedPosts.flatMap(post => hashtags(post.caption)))]
    .filter(matches).sort((a, b) => a.localeCompare(b, 'es'));
  return { active, characters, posts, tags };
}
