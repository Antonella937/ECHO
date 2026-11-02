import type { SocialState } from '@/domain/types';

/** Real relationships only, derived from state.follows. */
export function realFollowCounts(state: SocialState, id: string) {
  const following = (state.follows[id] ?? []).length;
  const followers = Object.entries(state.follows).filter(([k, list]) => k !== id && (list ?? []).includes(id)).length;
  return { followers, following };
}
