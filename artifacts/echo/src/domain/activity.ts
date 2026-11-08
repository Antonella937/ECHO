import type { SocialState } from './types';

/** Activity is inferred from recorded events, never from a fabricated online connection. */
export function lastRecordedActivity(state: SocialState, characterId: string): string | null {
  const dates = [
    ...state.posts.filter(p => p.authorId === characterId).map(p => p.createdAt),
    ...state.stories.filter(s => s.authorId === characterId).map(s => s.createdAt),
    ...state.messages.filter(m => m.senderId === characterId).map(m => m.createdAt),
    ...state.comments.filter(c => c.authorId === characterId).map(c => c.createdAt),
  ].map(value => new Date(value).getTime()).filter(Number.isFinite);
  if (!dates.length) return null;
  return new Date(Math.max(...dates)).toISOString();
}

export function recentlyActive(state: SocialState, characterId: string, now = Date.now()): boolean {
  const last = lastRecordedActivity(state, characterId);
  if (!last) return false;
  const age = now - new Date(last).getTime();
  return age >= 0 && age < 15 * 60_000;
}
