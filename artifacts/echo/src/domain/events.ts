import {
  threadIdFor,
  type CharacterId,
  type Comment,
  type Message,
  type Notification,
  type Post,
  type SocialState,
  type Story,
} from './types';
import { rememberActivity } from './character-memory';

/**
 * Every mutation in ECHO is a typed event. User actions and future autonomous
 * character activity (from a CharacterProvider) flow through the same reducer.
 */
export type EventSource = 'user' | 'provider' | 'system';

export type SocialEventPayload =
  | { type: 'post.created'; post: Post }
  | { type: 'post.deleted'; postId: string; actorId: CharacterId }
  | { type: 'post.liked'; postId: string; actorId: CharacterId; liked: boolean }
  | { type: 'post.saved'; postId: string; actorId: CharacterId; saved: boolean }
  | { type: 'story.created'; story: Story }
  | { type: 'story.seen'; storyId: string; actorId: CharacterId }
  | { type: 'story.liked'; storyId: string; actorId: CharacterId; liked: boolean }
  | { type: 'comment.created'; comment: Comment }
  | { type: 'comment.liked'; commentId: string; actorId: CharacterId; liked: boolean }
  | { type: 'message.sent'; message: Message }
  | { type: 'thread.read'; threadId: string; actorId: CharacterId }
  | { type: 'notification.read'; notificationId: string }
  | { type: 'notifications.readAll'; recipientId: CharacterId }
  | { type: 'identity.switched'; characterId: CharacterId }
  | { type: 'state.replaced'; state: SocialState };

export type SocialEvent = SocialEventPayload & {
  eventId: string;
  at: string;
  source: EventSource;
};

export function uid(prefix: string): string {
  return `${prefix}_${Date.now().toString(36)}${Math.random().toString(36).slice(2, 7)}`;
}

export function makeEvent(payload: SocialEventPayload, source: EventSource = 'user'): SocialEvent {
  return { ...payload, eventId: uid('ev'), at: new Date().toISOString(), source } as SocialEvent;
}

type NotifInput = Omit<Notification, 'id' | 'read' | 'createdAt'> & { createdAt?: string };

function notify(list: Notification[], n: NotifInput): Notification[] {
  if (n.recipientId === n.actorId) return list;
  return [{ id: uid('n'), read: false, createdAt: n.createdAt ?? new Date().toISOString(), ...n }, ...list];
}

const toggle = (arr: CharacterId[], id: CharacterId, on: boolean) =>
  on ? (arr.includes(id) ? arr : [...arr, id]) : arr.filter((x) => x !== id);

const clip = (s: string, n = 90) => (s.length > n ? `${s.slice(0, n - 1)}…` : s);

/** Pure reducer: (state, event) -> state. */
export function applyEvent(state: SocialState, ev: SocialEvent): SocialState {
  if ((ev.type === 'post.created' && state.posts.some(p => p.id === ev.post.id)) ||
      (ev.type === 'story.created' && state.stories.some(s => s.id === ev.story.id)) ||
      (ev.type === 'comment.created' && state.comments.some(c => c.id === ev.comment.id)) ||
      (ev.type === 'message.sent' && state.messages.some(m => m.id === ev.message.id))) return state;
  return rememberActivity(state, reduceEvent(state, ev), ev);
}
function reduceEvent(state: SocialState, ev: SocialEvent): SocialState {
  switch (ev.type) {
    case 'post.created':
      return { ...state, posts: [ev.post, ...state.posts] };

    case 'post.deleted': {
      const post = state.posts.find((p) => p.id === ev.postId);
      if (!post || post.authorId !== ev.actorId) return state;
      return {
        ...state,
        posts: state.posts.filter((p) => p.id !== ev.postId),
        comments: state.comments.filter((c) => c.postId !== ev.postId),
        notifications: state.notifications.filter((n) => n.postId !== ev.postId),
      };
    }

    case 'post.liked': {
      const post = state.posts.find((p) => p.id === ev.postId);
      if (!post) return state;
      const posts = state.posts.map((p) =>
        p.id === ev.postId ? { ...p, likes: toggle(p.likes, ev.actorId, ev.liked) } : p,
      );
      const notifications = ev.liked
        ? notify(state.notifications, {
            recipientId: post.authorId,
            actorId: ev.actorId,
            kind: 'like',
            postId: post.id,
            commentId: null,
            storyId: null,
            excerpt: clip(post.caption, 60),
            createdAt: ev.at,
          })
        : state.notifications.filter(
            (n) => !(n.kind === 'like' && n.postId === post.id && n.actorId === ev.actorId),
          );
      return { ...state, posts, notifications };
    }

    case 'post.saved':
      return {
        ...state,
        posts: state.posts.map((p) =>
          p.id === ev.postId ? { ...p, savedBy: toggle(p.savedBy, ev.actorId, ev.saved) } : p,
        ),
      };

    case 'story.created':
      return { ...state, stories: [ev.story, ...state.stories] };

    case 'story.liked': {
      const story = state.stories.find(s => s.id === ev.storyId);
      if (!story || story.authorId === ev.actorId) return state;
      const stories = state.stories.map(s => s.id === ev.storyId ? { ...s, likes: toggle(s.likes ?? [], ev.actorId, ev.liked) } : s);
      const notifications = ev.liked
        ? notify(state.notifications.filter(n => !(n.kind === 'story_like' && n.storyId === ev.storyId && n.actorId === ev.actorId)), {
            recipientId: story.authorId, actorId: ev.actorId, kind: 'story_like', postId: null,
            commentId: null, storyId: story.id, excerpt: clip(story.caption, 60), createdAt: ev.at,
          })
        : state.notifications.filter(n => !(n.kind === 'story_like' && n.storyId === ev.storyId && n.actorId === ev.actorId));
      return { ...state, stories, notifications };
    }

    case 'story.seen':
      return {
        ...state,
        stories: state.stories.map((s) =>
          s.id === ev.storyId ? { ...s, seenBy: toggle(s.seenBy, ev.actorId, true) } : s,
        ),
      };

    case 'comment.created': {
      const c = ev.comment;
      if (state.posts.find(p => p.id === c.postId)?.commentsEnabled === false) return state;
      const post = state.posts.find((p) => p.id === c.postId);
      if (!post) return state;
      let notifications = notify(state.notifications, {
        recipientId: post.authorId,
        actorId: c.authorId,
        kind: 'comment',
        postId: post.id,
        commentId: c.id,
        storyId: null,
        excerpt: clip(c.text),
        createdAt: ev.at,
      });
      const replyTarget =
        c.replyToAuthorId ?? state.comments.find((x) => x.id === c.parentId)?.authorId ?? null;
      if (replyTarget && replyTarget !== post.authorId) {
        notifications = notify(notifications, {
          recipientId: replyTarget,
          actorId: c.authorId,
          kind: 'reply',
          postId: post.id,
          commentId: c.id,
          storyId: null,
          excerpt: clip(c.text),
          createdAt: ev.at,
        });
      }
      return { ...state, comments: [...state.comments, c], notifications };
    }

    case 'comment.liked': {
      const c = state.comments.find((x) => x.id === ev.commentId);
      if (!c) return state;
      return {
        ...state,
        comments: state.comments.map((x) =>
          x.id === ev.commentId ? { ...x, likes: toggle(x.likes, ev.actorId, ev.liked) } : x,
        ),
        notifications: ev.liked
          ? notify(state.notifications, {
              recipientId: c.authorId,
              actorId: ev.actorId,
              kind: 'comment_like',
              postId: c.postId,
              commentId: c.id,
              storyId: null,
              excerpt: clip(c.text, 60),
              createdAt: ev.at,
            })
          : state.notifications.filter(
              (n) => !(n.kind === 'comment_like' && n.commentId === c.id && n.actorId === ev.actorId),
            ),
      };
    }

    case 'message.sent': {
      const m = { ...ev.message, threadId: threadIdFor(ev.message.senderId, ev.message.recipientId) };
      return {
        ...state,
        messages: [...state.messages, m],
        notifications: notify(state.notifications, {
          recipientId: m.recipientId,
          actorId: m.senderId,
          kind: m.storyId ? 'story_reply' : 'message',
          postId: m.postId,
          commentId: null,
          storyId: m.storyId,
          excerpt: clip(m.text),
          createdAt: ev.at,
        }),
      };
    }

    case 'thread.read':
      return {
        ...state,
        messages: state.messages.map((m) =>
          m.threadId === ev.threadId && !m.readBy.includes(ev.actorId)
            ? { ...m, readBy: [...m.readBy, ev.actorId] }
            : m,
        ),
        notifications: state.notifications.map((n) =>
          n.recipientId === ev.actorId &&
          (n.kind === 'message' || n.kind === 'story_reply') &&
          threadIdFor(n.actorId, n.recipientId) === ev.threadId
            ? { ...n, read: true }
            : n,
        ),
      };

    case 'notification.read':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.id === ev.notificationId ? { ...n, read: true } : n,
        ),
      };

    case 'notifications.readAll':
      return {
        ...state,
        notifications: state.notifications.map((n) =>
          n.recipientId === ev.recipientId ? { ...n, read: true } : n,
        ),
      };

    case 'identity.switched':
      if (!state.characters.some((c) => c.id === ev.characterId && !c.archived)) return state;
      return { ...state, currentCharacterId: ev.characterId };

    case 'state.replaced':
      return ev.state;
  }
}
