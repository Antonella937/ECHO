import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type ReactNode } from 'react';
import { applyEvent, makeEvent, uid, type EventSource, type SocialEvent, type SocialEventPayload } from '@/domain/events';
import { threadIdFor, type Character, type CharacterId, type ImageStyle, type SocialState } from '@/domain/types';
import type { ActivityAdapter } from '@/domain/providers';
import { createSeedState } from './seed';
import { UniverseSync, type SyncView } from './synchronization';
import { SyncNotices } from './sync-notices';
import { archiveAccount, editAccount, editPostMetrics, editStoryMetrics, validateAccount, type AccountInput, type PostMetrics, type StoryMetrics } from '@/domain/accounts';
import { deleteUnusedAccount, duplicateCharacter } from '@/domain/character-core';
import { validatePostMedia } from '@/domain/post-media';
import type { PostMedia } from '@/domain/types';
import type { Appearance, MessageAttachment, StoryHighlight } from '@/domain/types';
import { editSocialPost, setPinnedPost, movePinnedPost, toggleReaction, saveHighlight, mentionNotifications, isStoryActive, canViewStory, type PostEdit } from '@/domain/social-features';
import { getActiveUniverseId } from './persistence';
import { MediaScopeContext } from '@/lib/media';
import { playMessageSound } from '@/lib/message-sounds';

export interface SocialActions {
  editPost(id: string, patch: Partial<PostEdit>, expected?: Partial<PostEdit>): void;
  pinPost(id: string, pinned: boolean): void;
  movePinnedPost(id: string, direction: -1 | 1): void;
  reactStory(id: string, value: string): void;
  saveHighlight(highlight: StoryHighlight, expected?: StoryHighlight): void;
  deleteHighlight(id: string): void;
  reactMessage(id: string, value: string): void;
  hideMessage(id: string): void;
  editMessage(id: string, text: string): void;
  toggleSaveMessage(id: string): void;
  setAppearance(appearance: Appearance): void;
  setImageStyle(style: ImageStyle): void;
  createAccount(input: AccountInput): string;
  updateAccount(id: string, input: AccountInput, expected?: AccountInput): void;
  archiveAccount(id: string, archived: boolean): void;
  duplicateAccount(id: string): string;
  deleteAccount(id: string): void;
  updatePostMetrics(id: string, metrics: PostMetrics, expected?: PostMetrics): void;
  updateStoryMetrics(id: string, metrics: StoryMetrics, expected?: StoryMetrics): void;
  toggleLike(postId: string): void;
  toggleSave(postId: string): void;
  addComment(postId: string, text: string, parentId?: string | null, replyToAuthorId?: string | null): void;
  toggleCommentLike(commentId: string): void;
  createPost(input: { image: string; media?: PostMedia[]; caption: string; location: string; taggedAccountIds?: string[]; commentsEnabled?: boolean }): string;
  createStory(input: { image: string; caption: string; mentionedAccountIds?: string[]; music?: import('@workspace/api-client-react').StoryMusic; closeFriendsOnly?: boolean }): string;
  deletePost(postId: string): void;
  deleteStory(storyId: string): void;
  toggleCloseFriend(characterId: string): void;
  seeStory(storyId: string): void;
  sendMessage(to: CharacterId, text: string, extra?: { storyId?: string; postId?: string; quoteMessageId?: string; attachments?: MessageAttachment[] }): void;
  markThreadRead(otherId: CharacterId): void;
  markNotificationRead(id: string): void;
  markAllNotificationsRead(): void;
  switchIdentity(id: CharacterId): void;
  retrySync(): Promise<void>;
  refreshAfterApproval(): Promise<void>;
  resetAll(): Promise<void>;
}

interface StoreValue {
  universeId: string;
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
  const [mediaUniverseId] = useState(() => getActiveUniverseId(userId));
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
    }, undefined, mediaUniverseId);
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

  const refreshAfterApproval = useCallback(async () => {
    const engine = coordinator.current;
    if (!engine) throw new Error('Sync unavailable');
    await engine.refreshAfterApproval();
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
    const send: SocialActions['sendMessage'] = (to, text, extra) => {
      if (!cur().characters.some(c => c.id === to && !c.archived) || to === myId()) throw new Error('Elegí una cuenta disponible.');
      if (!text.trim() && !extra?.attachments?.length && !extra?.postId && !extra?.storyId) return;
      if (extra?.quoteMessageId && !cur().messages.some(m => m.id === extra.quoteMessageId && m.threadId === threadIdFor(myId(), to)))
        throw new Error('La cita debe pertenecer a esta conversación.');
      // Sending a reply means the sender has already engaged with this thread.
      // Clear older incoming unread markers before appending the outgoing message.
      const threadId = threadIdFor(myId(), to);
      if (cur().messages.some(m => m.threadId === threadId && m.recipientId === myId() && !m.readBy.includes(myId()))) {
        dispatch({ type: 'thread.read', threadId, actorId: myId() });
      }
      playMessageSound('outgoing');
      dispatch({ type: 'message.sent', message: { id: uid('m'), threadId, senderId: myId(), recipientId: to,
        text: text.trim(), createdAt: new Date().toISOString(), storyId: extra?.storyId ?? null, postId: extra?.postId ?? null,
        readBy: [myId()], origin: 'user', ...(extra?.quoteMessageId ? { quoteMessageId: extra.quoteMessageId } : {}),
        ...(extra?.attachments?.length ? { attachments: extra.attachments } : {}) } });
    };
    return {
      createAccount(input) {
        const data = validateAccount(input, cur());
        const id = uid('account');
        const account: Character = {
          ...data, id, occupation: data.occupation ?? '', location: data.location ?? '', accountType: data.accountType ?? 'personal',
          verified: data.verified ?? false, archived: false,
          providerRef: { provider: 'mock', externalId: null, status: 'not_connected', lastSyncAt: null },
          identity: data.identity ?? { provider: 'mock', referenceImages: [], seed: 0, appearance: '', styleNotes: '', updatedAt: new Date().toISOString() },
        };
        coordinator.current?.edit(s => ({ ...s, characters: [...s.characters, account] }));
        return id;
      },
      updateAccount(id, input, expected) {
        const next = editAccount(cur(), id, input, expected);
        coordinator.current?.edit(() => next);
      },
      duplicateAccount(id) {
        const newId = uid('account');
        const copy = duplicateCharacter(cur(), id, newId);
        coordinator.current?.edit(s => ({ ...s, characters: [...s.characters, copy] }));
        return newId;
      },
      deleteAccount(id) {
        const next = deleteUnusedAccount(cur(), id);
        coordinator.current?.edit(() => next);
      },
      archiveAccount(id, archived) {
        const next = archiveAccount(cur(), id, archived);
        coordinator.current?.edit(() => next);
      },
      updatePostMetrics(id, metrics, expected) {
        const next = editPostMetrics(cur(), id, metrics, expected);
        coordinator.current?.edit(() => next);
      },
      updateStoryMetrics(id, metrics, expected) {
        coordinator.current?.edit(s => editStoryMetrics(s, id, myId(), metrics, expected));
      },
      toggleLike(postId) {
        const p = cur().posts.find((x) => x.id === postId);
        if (p) dispatch({ type: 'post.liked', postId, actorId: myId(), liked: !p.likes.includes(myId()) });
      },
      toggleSave(postId) {
        const p = cur().posts.find((x) => x.id === postId);
        if (p) dispatch({ type: 'post.saved', postId, actorId: myId(), saved: !p.savedBy.includes(myId()) });
      },
      addComment(postId, text, parentId = null, replyToAuthorId = null) {
        const post = cur().posts.find(p => p.id === postId);
        if (!post || post.commentsEnabled === false) throw new Error('Los comentarios de esta publicación están desactivados.');
        if (!text.trim()) return;
        if (parentId && !cur().comments.some(c => c.id === parentId && c.postId === postId)) throw new Error('El comentario original ya no está disponible.');
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
      editPost(id, patch, expected) { coordinator.current?.edit(s => editSocialPost(s, id, myId(), patch, expected)); },
      pinPost(id, pinned) { coordinator.current?.edit(s => setPinnedPost(s, id, myId(), pinned)); },
      movePinnedPost(id, direction) { coordinator.current?.edit(s => movePinnedPost(s, id, myId(), direction)); },
      reactMessage(id, value) {
        coordinator.current?.edit(s => ({ ...s, messages: s.messages.map(m => m.id === id &&
          (m.senderId === myId() || m.recipientId === myId()) ? { ...m, reactions: toggleReaction(m.reactions, myId(), value) } : m) }));
      },
      editMessage(id, text) {
        const message = cur().messages.find(m => m.id === id);
        if (!message || message.senderId !== myId()) throw new Error('Solo podés editar tus propios mensajes.');
        if (!text.trim() || text.length > 10000) throw new Error('El mensaje debe tener entre 1 y 10000 caracteres.');
        coordinator.current?.edit(s => ({ ...s, messages: s.messages.map(m => m.id === id ? { ...m, text: text.trim(), editedAt: new Date().toISOString() } : m) }));
      },
      toggleSaveMessage(id) {
        const message = cur().messages.find(m => m.id === id);
        if (!message || ![message.senderId, message.recipientId].includes(myId())) throw new Error('Mensaje no disponible.');
        coordinator.current?.edit(s => ({ ...s, messages: s.messages.map(m => m.id === id ? { ...m, savedByIds: (m.savedByIds ?? []).includes(myId()) ? (m.savedByIds ?? []).filter(x => x !== myId()) : [...(m.savedByIds ?? []), myId()] } : m) }));
      },
      hideMessage(id) {
        coordinator.current?.edit(s => ({ ...s, messages: s.messages.map(m => m.id === id &&
          [m.senderId, m.recipientId].includes(myId())
          ? { ...m, hiddenForIds: [...new Set([...(m.hiddenForIds ?? []), myId()])] } : m) }));
      },
      reactStory(id, value) {
        const story = cur().stories.find(s => s.id === id);
        if (!story || !canViewStory(story, myId(), cur()) || !isStoryActive(story) || story.authorId === myId()) return;
        const removing = story.reactions?.some(r => r.actorId === myId() && r.value === value);
        coordinator.current?.edit(s => ({ ...s, stories: s.stories.map(st => st.id === id ? { ...st, reactions: toggleReaction(st.reactions, myId(), value) } : st) }));
        if (!removing) send(story.authorId, value, { storyId: id });
      },
      toggleCloseFriend(characterId) {
        if (characterId === myId() || !cur().characters.some(c => c.id === characterId && !c.archived)) throw new Error('Elegí otro personaje disponible.');
        coordinator.current?.edit(s => {
          const list = s.closeFriends?.[myId()] ?? [];
          return { ...s, closeFriends: { ...(s.closeFriends ?? {}), [myId()]: list.includes(characterId) ? list.filter(id => id !== characterId) : [...list, characterId] } };
        });
      },
      deleteStory(storyId) {
        const story = cur().stories.find(s => s.id === storyId);
        if (!story || story.authorId !== myId()) throw new Error('Solo podés eliminar tus propias historias.');
        coordinator.current?.edit(s => ({
          ...s,
          stories: s.stories.filter(item => item.id !== storyId),
          highlights: (s.highlights ?? []).flatMap(h => {
            if (!h.storyIds.includes(storyId)) return [h];
            const storyIds = h.storyIds.filter(id => id !== storyId);
            return [{ ...h, storyIds, coverStoryId: h.coverStoryId === storyId ? null : h.coverStoryId }];
          }),
          notifications: s.notifications.filter(n => n.storyId !== storyId),
          messages: s.messages.map(m => m.storyId === storyId ? { ...m, storyId: null } : m),
        }));
      },
      saveHighlight(highlight, expected) { coordinator.current?.edit(s => saveHighlight(s, myId(), highlight, expected)); },
      deleteHighlight(id) { coordinator.current?.edit(s => ({ ...s, highlights: s.highlights?.filter(h => h.id !== id || h.authorId !== myId()) })); },
      setImageStyle(style) {
        if (!['natural', 'phone', 'analog', 'editorial', 'cinematic'].includes(style)) throw new Error('Estilo de imagen inválido.');
        coordinator.current?.edit(s => ({ ...s, imageStyle: style }));
      },
      setAppearance(appearance) {
        if (!['dark', 'light', 'system'].includes(appearance.theme) || !/^#[a-f0-9]{6}$/i.test(appearance.accent)) throw new Error('Apariencia inválida.');
        coordinator.current?.edit(s => ({ ...s, appearance }));
      },
      createPost({ image, media, caption, location, taggedAccountIds, commentsEnabled }) {
        if (media) validatePostMedia(media);
        const id = uid('p');
        dispatch({
          type: 'post.created',
          post: {
            id,
            authorId: myId(),
            image: media?.[0].url ?? image,
            ...(media ? { media: structuredClone(media) } : {}),
            caption: caption.trim(),
            location: location.trim(),
            createdAt: new Date().toISOString(),
            likes: [],
            savedBy: [],
            origin: 'user',
            illustrative: false,
            ...(taggedAccountIds ? { taggedAccountIds } : {}),
            ...(commentsEnabled !== undefined ? { commentsEnabled } : {}),
          },
        });
        coordinator.current?.edit(s => mentionNotifications(s, caption, myId(), { postId: id }, taggedAccountIds));
        return id;
      },
      createStory({ image, caption, mentionedAccountIds, music, closeFriendsOnly }) {
        const allowedViewerIds = closeFriendsOnly ? (cur().closeFriends?.[myId()] ?? []) : [];
        if (closeFriendsOnly && !allowedViewerIds.length) throw new Error('Agregá al menos un mejor amigo antes de publicar.');
        const id = uid('s');
        dispatch({
          type: 'story.created',
          story: { id, authorId: myId(), image, caption: caption.trim(), createdAt: new Date().toISOString(), seenBy: [], origin: 'user',
            ...(mentionedAccountIds ? { mentionedAccountIds: mentionedAccountIds.filter(id => !closeFriendsOnly || allowedViewerIds.includes(id)) } : {}),
            ...(closeFriendsOnly ? { closeFriendsOnly: true, allowedViewerIds } : {}), ...(music ? { music } : {}) },
        });
        coordinator.current?.edit(s => {
          const next = mentionNotifications(s, caption, myId(), { storyId: id }, mentionedAccountIds);
          return closeFriendsOnly ? { ...next, notifications: next.notifications.filter(n => n.storyId !== id || allowedViewerIds.includes(n.recipientId)) } : next;
        });
        return id;
      },
      deletePost(postId) {
        dispatch({ type: 'post.deleted', postId, actorId: myId() });
      },
      seeStory(storyId) {
        const s = cur().stories.find((x) => x.id === storyId);
        if (s && canViewStory(s, myId(), cur()) && !s.seenBy.includes(myId()) && s.authorId !== myId())
          dispatch({ type: 'story.seen', storyId, actorId: myId() });
      },
      sendMessage(to, text, extra) {
        send(to, text, extra);
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
        if (cur().characters.some((character) => character.id === id && !character.archived)) {
          dispatch({ type: 'identity.switched', characterId: id });
        }
      },
      retrySync,
      refreshAfterApproval,
      async resetAll() {
        coordinator.current?.edit(() => createSeedState());
        await retrySync();
      },
    };
  }, [dispatch, retrySync, refreshAfterApproval]);

  const value = useMemo<StoreValue | null>(() => {
    if (!state || !meId) return null;
    const me = state.characters.find((c) => c.id === meId) ?? state.characters[0];
    return {
      universeId: mediaUniverseId,
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
  }, [state, meId, mediaUniverseId, storageError, lastSavedAt, syncing, actions, dispatch, adapter]);

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
      <MediaScopeContext.Provider value={{ universeId: mediaUniverseId, state: value.state }}>
      {children}
      <SyncNotices view={view} engine={coordinator.current} />
      </MediaScopeContext.Provider>
    </Ctx.Provider>
  );
}

export function useSocial(): StoreValue {
  const v = useContext(Ctx);
  if (!v) throw new Error('useSocial must be used inside SocialStoreProvider');
  return v;
}
