import { useEffect, useMemo, useState } from 'react';
import { useSocial } from '@/store/social-store';
import { threadIdFor, type Character, type Message, type Story } from '@/domain/types';
import { hasMessageContent, selectInbox } from '@/domain/inbox';
import { canViewStory, isStoryActive } from '@/domain/social-features';

export const hiddenFor = (m: Message, id: string) => !!m.hiddenForIds?.includes(id);
export type { ThreadSummary } from '@/domain/inbox';

const byDateDesc = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
const byDateAsc = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

export function useUnreadCounts() {
  const { state, me } = useSocial();
  return useMemo(
    () => ({
      notifications: state.notifications.filter((n) => n.recipientId === me.id && !n.read && n.kind !== 'message' && n.kind !== 'story_reply').length,
      messages: selectInbox(state, me.id).reduce((total, thread) => total + thread.unread, 0),
    }),
    [state.notifications, state.messages, me.id],
  );
}

export function useFeed() {
  const { state, me } = useSocial();
  return useMemo(() => {
    const followed = new Set(state.follows[me.id] ?? []);
    return state.posts.filter((post) => post.authorId === me.id || (followed.has(post.authorId) && (!state.characters.find((c) => c.id === post.authorId)?.privateAccount || followed.has(post.authorId)))).sort(byDateDesc);
  }, [state.posts, state.follows, state.characters, me.id]);
}

export interface StoryGroup {
  author: Character;
  stories: Story[];
  allSeen: boolean;
}

/** Story groups ordered: unseen first, then most recent. Includes current character. */
export function useStoryGroups(): StoryGroup[] {
  const { state, me } = useSocial();
  const [clock, setClock] = useState(Date.now);
  useEffect(() => {
    const timer = window.setInterval(() => setClock(Date.now()), 1000);
    return () => window.clearInterval(timer);
  }, []);
  const now = Date.now();
  return useMemo(() => {
    const groups: StoryGroup[] = [];
    for (const c of state.characters) {
      const stories = state.stories.filter((s) => s.authorId === c.id && isStoryActive(s, now) && canViewStory(s, me.id, state)).sort(byDateAsc);
      if (!stories.length) continue;
      const allSeen = c.id === me.id || stories.every((s) => s.seenBy.includes(me.id));
      groups.push({ author: c, stories, allSeen });
    }
    return groups.sort((a, b) => {
      if (a.author.id === me.id) return -1;
      if (b.author.id === me.id) return 1;
      if (a.allSeen !== b.allSeen) return a.allSeen ? 1 : -1;
      return byDateDesc(a.stories[a.stories.length - 1], b.stories[b.stories.length - 1]);
    });
  }, [state.stories, state.characters, me.id, clock, now]);
}

export function useThreads() {
  const { state, me } = useSocial();
  return useMemo(() => selectInbox(state, me.id), [state.messages, state.characters, me.id]);
}

export function useThreadMessages(otherId: string) {
  const { state, me } = useSocial();
  return useMemo(() => {
    const tid = threadIdFor(me.id, otherId);
    return state.messages.filter((m) => m.threadId === tid && !hiddenFor(m, me.id)).sort(byDateAsc);
  }, [state.messages, me.id, otherId]);
}

export { byDateAsc, byDateDesc };
