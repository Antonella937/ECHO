import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyEvent, makeEvent, uid, type EventSource, type SocialEvent, type SocialEventPayload } from '@/domain/events';
import { SCHEMA_VERSION, threadIdFor, type Character, type CharacterId, type SocialState } from '@/domain/types';
import type { ActivityAdapter } from '@/domain/providers';
import { clearState, loadState, saveState } from './persistence';
import { createSeedState } from './seed';
import { toast } from '@/hooks/use-toast';

export interface SocialActions {
  toggleLike(postId: string): void;
  toggleSave(postId: string): void;
  addComment(postId: string, text: string, parentId?: string | null, replyToAuthorId?: string | null): void;
  toggleCommentLike(commentId: string): void;
  createPost(input: { image: string; caption: string; location: string }): string;
  createStory(input: { image: string; caption: string }): string;
  deletePost(postId: string): void;
  seeStory(storyId: string): void;
  sendMessage(to: CharacterId, text: string, extra?: { storyId?: string; postId?: string }): void;
  markThreadRead(otherId: CharacterId): void;
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;
  switchIdentity(id: CharacterId): void;
  resetAll(): Promise<void>;
}

interface StoreValue {
  state: SocialState;
  me: Character;
  storageError: string | null;
  lastSavedAt: number | null;
  actions: SocialActions;
  dispatch(payload: SocialEventPayload, source?: EventSource): SocialEvent;
  adapter: ActivityAdapter;
  character(id: CharacterId): Character | undefined;
}

const Ctx = createContext<StoreValue | null>(null);

export function SocialStoreProvider({ children, fallback }: { children: ReactNode; fallback: ReactNode }) {
  const [state, setState] = useState<SocialState | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const stateRef = useRef<SocialState | null>(null);
  stateRef.current = state;

  useEffect(() => {
    loadState()
      .then((s) => setState(s && s.version === SCHEMA_VERSION ? s : createSeedState()))
      .catch(() => {
        setStorageError('No se pudo leer el almacenamiento local. Empezamos con los datos de ejemplo.');
        setState(createSeedState());
      });
  }, []);

  useEffect(() => {
    if (!state) return;
    const t = setTimeout(() => {
      saveState(state)
        .then(() => {
          setStorageError(null);
          setLastSavedAt(Date.now());
        })
        .catch((e: Error) => {
          setStorageError(e.message);
          toast({ title: 'No se ha podido guardar', description: e.message, variant: 'destructive' });
        });
    }, 250);
    return () => clearTimeout(t);
  }, [state]);

  const dispatch = useCallback((payload: SocialEventPayload, source: EventSource = 'user') => {
    const ev = makeEvent(payload, source);
    setState((s) => (s ? applyEvent(s, ev) : s));
    return ev;
  }, []);

  const adapter = useMemo<ActivityAdapter>(
    () => ({ ingest: (events) => setState((s) => (s ? events.reduce(applyEvent, s) : s)) }),
    [],
  );

  const meId = state?.currentCharacterId;

  const actions = useMemo<SocialActions>(() => {
    const cur = () => stateRef.current!;
    const myId = () => cur().currentCharacterId;
    return {
      toggleLike(postId) {
        const p = cur().posts.find((x) => x.id === postId);
        if (p) dispatch({ type: 'post.liked', postId, actorId: myId(), liked: !p.likes.includes(myId()) });
      },
      toggleSave(postId) {
        const p = cur().posts.find((x) => x.id === postId);
        if (p) dispatch({ type: 'post.saved', postId, actorId: myId(), saved: !p.savedBy.includes(myId()) });
      },
      addComment(postId, text, parentId = null, replyToAuthorId = null) {
        dispatch({
          type: 'comment.created',
          comment: {
            id: uid('c'),
            postId,
            authorId: myId(),
            text: text.trim(),
            createdAt: new Date().toISOString(),
            parentId,
            replyToAuthorId,
            likes: [],
            origin: 'user',
          },
        });
      },
      toggleCommentLike(commentId) {
        const c = cur().comments.find((x) => x.id === commentId);
        if (c) dispatch({ type: 'comment.liked', commentId, actorId: myId(), liked: !c.likes.includes(myId()) });
      },
      createPost({ image, caption, location }) {
        const id = uid('p');
        dispatch({
          type: 'post.created',
          post: {
            id,
            authorId: myId(),
            image,
            caption: caption.trim(),
            location: location.trim(),
            createdAt: new Date().toISOString(),
            likes: [],
            savedBy: [],
            origin: 'user',
            illustrative: false,
          },
        });
        return id;
      },
      createStory({ image, caption }) {
        const id = uid('s');
        dispatch({
          type: 'story.created',
          story: { id, authorId: myId(), image, caption: caption.trim(), createdAt: new Date().toISOString(), seenBy: [], origin: 'user' },
        });
        return id;
      },
      deletePost(postId) {
        dispatch({ type: 'post.deleted', postId, actorId: myId() });
      },
      seeStory(storyId) {
        const s = cur().stories.find((x) => x.id === storyId);
        if (s && !s.seenBy.includes(myId()) && s.authorId !== myId())
          dispatch({ type: 'story.seen', storyId, actorId: myId() });
      },
      sendMessage(to, text, extra) {
        dispatch({
          type: 'message.sent',
          message: {
            id: uid('m'),
            threadId: threadIdFor(myId(), to),
            senderId: myId(),
            recipientId: to,
            text: text.trim(),
            createdAt: new Date().toISOString(),
            storyId: extra?.storyId ?? null,
            postId: extra?.postId ?? null,
            readBy: [myId()],
            origin: 'user',
          },
        });
      },
      markThreadRead(otherId) {
        const tid = threadIdFor(myId(), otherId);
        const unread = cur().messages.some((m) => m.threadId === tid && !m.readBy.includes(myId()));
        if (unread) dispatch({ type: 'thread.read', threadId: tid, actorId: myId() });
      },
      markNotificationRead(id) {
        dispatch({ type: 'notification.read', notificationId: id });
      },
      markAllNotificationsRead() {
        dispatch({ type: 'notifications.readAll', recipientId: myId() });
      },
      switchIdentity(id) {
        dispatch({ type: 'identity.switched', characterId: id });
      },
      async resetAll() {
        await clearState();
        dispatch({ type: 'state.replaced', state: createSeedState() }, 'system');
      },
    };
  }, [dispatch]);

  const value = useMemo<StoreValue | null>(() => {
    if (!state || !meId) return null;
    const me = state.characters.find((c) => c.id === meId) ?? state.characters[0];
    return {
      state,
      me,
      storageError,
      lastSavedAt,
      actions,
      dispatch,
      adapter,
      character: (id) => state.characters.find((c) => c.id === id),
    };
  }, [state, meId, storageError, lastSavedAt, actions, dispatch, adapter]);

  if (!value) return <>{fallback}</>;
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export function useSocial(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSocial must be used inside SocialStoreProvider');
  return v;
}
