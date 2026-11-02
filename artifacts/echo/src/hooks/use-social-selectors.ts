import { useEffect, useMemo, useState } from 'react';
import { useSocial } from '@/store/social-store';
import { threadIdFor, type Character, type Message, type Story } from '@/domain/types';
import { hasMessageContent, selectInbox } from '@/domain/inbox';
import { isStoryActive } from '@/domain/social-features';

export const hiddenFor = (m: Message, id: string) => !!m.hiddenForIds?.includes(id);
export type { ThreadSummary } from '@/domain/inbox';

const byDateDesc = <T extends { createdAt: string }>(a: T, b: T) => b.createdAt.localeCompare(a.createdAt);
const byDateAsc = <T extends { createdAt: string }>(a: T, b: T) => a.createdAt.localeCompare(b.createdAt);

export function useUnreadCounts() {
  const { state, me } = useSocial();
  return useMemo(
    () => ({
      notifications: state.notifications.filter((n) => n.recipientId === me.id && !n.read && n.kind !== 'message' && n.kind !== 'story_reply').length,
      messages: state.messages.filter((m) => hasMessageContent(m) && !hiddenFor(m, me.id) && m.recipientId === me.id && !m.readBy.includes(me.id)).length,
    }),
    [state.notifications, state.messages, me.id],
  );
}

export function useFeed() {
  const { state } = useSocial();
  return useMemo(() => [...state.posts].sort(byDateDesc), [state.posts]);
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
      const stories = state.stories.filter((s) => s.authorId === c.id && isStoryActive(s, now)).sort(byDateAsc);
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
