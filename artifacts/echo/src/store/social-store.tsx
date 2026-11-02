import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyEvent, makeEvent, uid, type EventSource, type SocialEvent, type SocialEventPayload } from '@/domain/events';
import { SCHEMA_VERSION, threadIdFor, type Character, type CharacterId, type SocialState } from '@/domain/types';
import type { ActivityAdapter } from '@/domain/providers';
import {
  clearLegacyState,
  loadLegacyState,
  loadUniverse,
  moveLocalImagesToPrivateStorage,
  saveUniverse,
} from './persistence';
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
  retrySync(): Promise<void>;
  resetAll(): Promise<void>;
}

interface StoreValue {
  state: SocialState;
  me: Character;
  storageError: string | null;
  lastSavedAt: number | null;
  syncing: boolean;
  actions: SocialActions;
  dispatch(payload: SocialEventPayload, source?: EventSource): SocialEvent;
  adapter: ActivityAdapter;
  character(id: CharacterId): Character | undefined;
}

const Ctx = createContext<StoreValue | null>(null);

export function SocialStoreProvider({ children, fallback, userId }: { children: ReactNode; fallback: ReactNode; userId: string }) {
  const [state, setState] = useState<SocialState | null>(null);
  const [storageError, setStorageError] = useState<string | null>(null);
  const [lastSavedAt, setLastSavedAt] = useState<number | null>(null);
  const [syncing, setSyncing] = useState(false);
  const stateRef = useRef<SocialState | null>(null);
  const syncInProgressRef = useRef(false);
  const activeRef = useRef(true);
  const serverCheckedRef = useRef(false);
  const serverHasDataRef = useRef(false);
  const pendingInitialSyncRef = useRef(false);
  const saveQueueRef = useRef<Promise<void>>(Promise.resolve());
  stateRef.current = state;

  const initialize = useCallback(async () => {
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    setStorageError(null);
    try {
      const serverState = await loadUniverse();
      if (!activeRef.current) return;
      serverCheckedRef.current = true;
      if (serverState) {
        serverHasDataRef.current = true;
        stateRef.current = serverState;
        setState(serverState);
        setLastSavedAt(Date.now());
        return;
      }

      const legacyState = await loadLegacyState();
      if (!activeRef.current) return;
      const initialState = legacyState ?? createSeedState();
      if (initialState.version !== SCHEMA_VERSION) {
        throw new Error('La versión de los datos locales no es compatible. No se ha borrado ni reemplazado.');
      }
      serverHasDataRef.current = false;
      pendingInitialSyncRef.current = true;
      stateRef.current = initialState;

      const stateWithPrivateImages = await moveLocalImagesToPrivateStorage(initialState);
      const savedState = await saveUniverse(stateWithPrivateImages);
      await clearLegacyState();
      if (!activeRef.current) return;
      stateRef.current = savedState;
      setState(savedState);
      serverHasDataRef.current = true;
      pendingInitialSyncRef.current = false;
      setLastSavedAt(Date.now());
    } catch (error) {
      if (activeRef.current) {
        if (stateRef.current) setState(stateRef.current);
        setStorageError((error as Error).message || 'No se pudo sincronizar tu universo.');
      }
    } finally {
      syncInProgressRef.current = false;
    }
  }, []);

  useEffect(() => {
    activeRef.current = true;
    void initialize();
    return () => {
      activeRef.current = false;
    };
  }, [initialize, userId]);

  useEffect(() => {
    if (!state || pendingInitialSyncRef.current) return;
    const t = setTimeout(() => {
      const snapshot = state;
      saveQueueRef.current = saveQueueRef.current
        .catch(() => undefined)
        .then(async () => {
          if (!activeRef.current) return;
          await saveUniverse(snapshot);
          if (!activeRef.current) return;
          setStorageError(null);
          setLastSavedAt(Date.now());
        })
        .catch((e: Error) => {
          if (!activeRef.current) return;
          setStorageError(e.message);
          toast({ title: 'No se ha podido guardar', description: e.message, variant: 'destructive' });
        });
    }, 250);
    return () => clearTimeout(t);
  }, [state]);

  const retrySync = useCallback(async () => {
    if (!serverCheckedRef.current) {
      await initialize();
      return;
    }
    if (syncInProgressRef.current) return;
    syncInProgressRef.current = true;
    setSyncing(true);
    setStorageError(null);
    try {
      if (!serverHasDataRef.current) {
        const serverState = await loadUniverse();
        if (serverState) {
          stateRef.current = serverState;
          setState(serverState);
          serverHasDataRef.current = true;
          pendingInitialSyncRef.current = false;
          setLastSavedAt(Date.now());
          return;
        }
      }
      const currentState = stateRef.current ?? createSeedState();
      const stateWithPrivateImages = await moveLocalImagesToPrivateStorage(currentState);
      if (!activeRef.current) return;
      const savedState = await saveUniverse(stateWithPrivateImages);
      await clearLegacyState();
      stateRef.current = savedState;
      setState(savedState);
      serverHasDataRef.current = true;
      pendingInitialSyncRef.current = false;
      setStorageError(null);
      setLastSavedAt(Date.now());
    } catch (error) {
      setStorageError((error as Error).message || 'No se pudo sincronizar tu universo.');
      throw error;
    } finally {
      syncInProgressRef.current = false;
      setSyncing(false);
    }
  }, [initialize]);

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
        if (cur().characters.some((character) => character.id === id)) {
          dispatch({ type: 'identity.switched', characterId: id });
        }
      },
      retrySync,
      async resetAll() {
        const seed = createSeedState();
        stateRef.current = seed;
        setState(seed);
        await saveQueueRef.current.catch(() => undefined);
        if (!activeRef.current) return;
        const savedState = await saveUniverse(seed);
        await clearLegacyState();
        stateRef.current = savedState;
        setState(savedState);
        setLastSavedAt(Date.now());
      },
    };
  }, [dispatch, retrySync]);

  const value = useMemo<StoreValue | null>(() => {
    if (!state || !meId) return null;
    const me = state.characters.find((c) => c.id === meId) ?? state.characters[0];
    return {
      state,
      me,
      storageError,
      lastSavedAt,
      syncing,
      actions,
      dispatch,
      adapter,
      character: (id) => state.characters.find((c) => c.id === id),
    };
  }, [state, meId, storageError, lastSavedAt, syncing, actions, dispatch, adapter]);

  if (!value) {
    if (!storageError) return <>{fallback}</>;
    return (
      <main className="grid min-h-[100dvh] place-items-center bg-background px-6 text-foreground">
        <div className="w-full max-w-sm rounded-3xl border border-border bg-card p-6">
          <h1 className="font-display text-xl">No se pudo abrir tu universo</h1>
          <p role="alert" className="mt-3 text-sm leading-relaxed text-muted-foreground">{storageError}</p>
          <button
            type="button"
            onClick={() => void initialize()}
            className="mt-5 h-11 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
          >
            Reintentar
          </button>
        </div>
      </main>
    );
  }
  return (
    <Ctx.Provider value={value}>
      {children}
      {syncing && (
        <div className="fixed inset-0 z-[100] grid place-items-center bg-background/70 px-6 backdrop-blur-sm" role="status">
          <div className="rounded-2xl border border-border bg-card px-5 py-4 text-sm font-medium shadow-xl">
            Sincronizando tu universo…
          </div>
        </div>
      )}
    </Ctx.Provider>
  );
}

export function useSocial(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSocial must be used inside SocialStoreProvider');
  return v;
}
