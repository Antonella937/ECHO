import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyEvent, makeEvent, uid, type EventSource, type SocialEvent, type SocialEventPayload } from '@/domain/events';
import { threadIdFor, type Character, type CharacterId, type SocialState } from '@/domain/types';
import type { ActivityAdapter } from '@/domain/providers';
import { createSeedState } from './seed';
import { UniverseSync, type SyncView } from './synchronization';
import { SyncNotices } from './sync-notices';

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
  const [view, setView] = useState<SyncView>({
    state: null, error: null, busy: false, lastSavedAt: null,
    conflicts: [], legacyAvailable: false, importVerified: false, importing: false,
  });
  const { state, error: storageError, busy: syncing, lastSavedAt } = view;
  const stateRef = useRef<SocialState | null>(null);
  const coordinator = useRef<UniverseSync | null>(null);
  stateRef.current = state;

  useEffect(() => {
    const engine = new UniverseSync(userId, createSeedState, next => {
      stateRef.current = next.state;
      setView(next);
    });
    coordinator.current = engine;
    void engine.initialize();
    const refresh = () => { if (document.visibilityState !== 'hidden') void engine.sync(); };
    const timer = window.setInterval(refresh, 5000);
    window.addEventListener('online', refresh);
    window.addEventListener('focus', refresh);
    document.addEventListener('visibilitychange', refresh);
    return () => {
      engine.stop();
      window.clearInterval(timer);
      window.removeEventListener('online', refresh);
      window.removeEventListener('focus', refresh);
      document.removeEventListener('visibilitychange', refresh);
    };
  }, [userId]);

  useEffect(() => {
    if (!state || view.conflicts.length) return;
    const t = setTimeout(() => void coordinator.current?.sync(), 400);
    return () => clearTimeout(t);
  }, [state, view.conflicts.length]);

  const retrySync = useCallback(async () => {
    const engine = coordinator.current;
    if (!engine) return;
    if (!engine.view.state) await engine.initialize();
    else await engine.sync();
    if (engine.view.error || engine.view.conflicts.length)
      throw new Error(engine.view.error ?? 'Resuelve los cambios en conflicto para continuar.');
  }, []);

  const dispatch = useCallback((payload: SocialEventPayload, source: EventSource = 'user') => {
    const ev = makeEvent(payload, source);
    coordinator.current?.edit(s => applyEvent(s, ev));
    return ev;
  }, []);

  const adapter = useMemo<ActivityAdapter>(
    () => ({ ingest: (events) => coordinator.current?.edit(s => events.reduce(applyEvent, s)) }),
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
        coordinator.current?.edit(() => createSeedState());
        await retrySync();
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
            onClick={() => void retrySync().catch(() => undefined)}
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
      <SyncNotices view={view} engine={coordinator.current} />
    </Ctx.Provider>
  );
}

export function useSocial(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSocial must be used inside SocialStoreProvider');
  return v;
}
