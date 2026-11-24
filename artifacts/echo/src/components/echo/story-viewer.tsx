import { MusicClipPlayer } from './music-clip-player';
import { useStoryViewerText } from '@/lib/story-viewer-translations';
import { VerifiedBadge } from './verified-badge';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AtSign, ChevronDown, ChevronLeft, ChevronRight, Eye, Heart, Music2, Send, Trash2, X } from 'lucide-react';
import { canViewStory, canRepostMentionedStory, isStoryActive } from '@/domain/social-features';
import { storyViewCount, storyViewerIds, formatCount } from '@/domain/accounts';
import { StoryMetricsEditor } from './story-metrics-editor';
import { SocialText } from './social-text';
import { MentionSuggestions } from './mention-suggestions';

const STORY_REACTIONS = ['❤', '😂', '😮', '😢', '🔥', '👏'];
import { useLocation } from 'wouter';
import { useSocial } from '@/store/social-store';
import { useStoryGroups, type StoryGroup } from '@/hooks/use-social-selectors';
import { retryPrivateMedia, useMediaResolver, timeAgo } from '@/lib/media';
import { CharacterAvatar } from './avatar';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { customFetch } from '@workspace/api-client-react';

const DEFAULT_STORY_DURATION_MS = 10000;

interface ViewerCtx {
  openStories(authorId: string, onlyAuthor?: boolean): void;
  /** Opens an explicit list (archive / highlight); may include expired stories. */
  openStoryList(authorId: string, storyIds: string[]): void;
}
const Ctx = createContext<ViewerCtx>({ openStories: () => {}, openStoryList: () => {} });
type Session = { kind: 'rail'; ids: string[]; index: number } | { kind: 'list'; authorId: string; storyIds: string[] };
export const useStoryViewer = () => useContext(Ctx);

export function StoryViewerProvider({ children }: { children: ReactNode }) {
  const groups = useStoryGroups();
  const { state, character } = useSocial();
  const [session, setSession] = useState<Session | null>(null);

  const openStories = useCallback(
    (authorId: string, onlyAuthor = false) => {
      const ids = onlyAuthor ? [authorId] : groups.map((g) => g.author.id);
      const index = Math.max(0, ids.indexOf(authorId));
      setSession({ kind: 'rail', ids, index });
    },
    [groups],
  );
  const openStoryList = useCallback((authorId: string, storyIds: string[]) => {
    if (storyIds.length) setSession({ kind: 'list', authorId, storyIds });
  }, []);

  const sessionGroups = useMemo((): StoryGroup[] => {
    if (!session) return [];
    if (session.kind === 'rail') return session.ids.map((id) => groups.find((g) => g.author.id === id)).filter((g): g is StoryGroup => !!g);
    const author = character(session.authorId);
    const stories = session.storyIds.map((id) => state.stories.find((s) => s.id === id)).filter((s): s is NonNullable<typeof s> => !!s && canViewStory(s, state.currentCharacterId, state));
    return author && stories.length ? [{ author, stories, allSeen: true }] : [];
  }, [session, groups, state.stories, character]);
  const startIndex = session?.kind === 'rail' ? session.index : 0;

  return (
    <Ctx.Provider value={{ openStories, openStoryList }}>
      {children}
      {createPortal(
        <AnimatePresence>
          {session && sessionGroups.length > 0 && (
            <Viewer
              key="viewer"
              groups={sessionGroups}
              startIndex={Math.min(startIndex, sessionGroups.length - 1)}
              onClose={() => setSession(null)}
            />
          )}
        </AnimatePresence>,
        document.body,
      )}
    </Ctx.Provider>
  );
}

function Viewer({ groups, startIndex, onClose }: { groups: StoryGroup[]; startIndex: number; onClose(): void }) {
  const t = useStoryViewerText();
  const resolveMedia = useMediaResolver();
  const [failedStoryImage, setFailedStoryImage] = useState<string | null>(null);
  const [storyImageWaitExpired, setStoryImageWaitExpired] = useState(false);
  const { me, actions, state, character, universeId } = useSocial();
  const [, navigate] = useLocation();
  const [gi, setGi] = useState(startIndex);
  const [si, setSi] = useState(() => {
    const g = groups[startIndex];
    const firstUnseen = g.stories.findIndex((s) => !s.seenBy.includes(me.id));
    return g.author.id !== me.id && firstUnseen >= 0 ? firstUnseen : 0;
  });
  const [paused, setPaused] = useState(false);
  const [replyFocused, setReplyFocused] = useState(false);
  const [reply, setReply] = useState('');
  const [showViewers, setShowViewers] = useState(false);
  const [viewerFilter, setViewerFilter] = useState<'views' | 'likes'>('views');
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [showShare, setShowShare] = useState(false);
  const [reposting, setReposting] = useState(false);
  const [repostComposerOpen, setRepostComposerOpen] = useState(false);
  const [repostCaption, setRepostCaption] = useState('');
  const [shareSearch, setShareSearch] = useState('');
  const [editingMetricsId, setEditingMetricsId] = useState<string | null>(null);
  const inputRef = useRef<HTMLTextAreaElement>(null);
  const swipeStartY = useRef<number | null>(null);

  const group = groups[Math.min(gi, groups.length - 1)];
  const story = group.stories[Math.min(si, group.stories.length - 1)];
  const isMine = group.author.id === me.id;
  const liveStory = state.stories.find((s) => s.id === story.id) ?? story;
  const editingMetrics = editingMetricsId === story.id;
  // A music story stays open for the full selected clip (15 or 30 seconds).
  // Stories without a valid music clip retain their standard duration.
  const storyDurationMs = liveStory.musicClip && (liveStory.musicClip.clipSeconds === 15 || liveStory.musicClip.clipSeconds === 30)
    ? liveStory.musicClip.clipSeconds * 1000 : DEFAULT_STORY_DURATION_MS;
  const isStoryRepost = Boolean(liveStory.repostOfStoryId);
  const originalStory = liveStory.repostOfStoryId ? state.stories.find(s => s.id === liveStory.repostOfStoryId) : undefined;
  const originalAuthor = originalStory ? state.characters.find(c => c.id === originalStory.authorId) : undefined;
  const canShowOriginalStory = Boolean(originalStory && originalAuthor && !originalAuthor.privateAccount && !originalAuthor.archived && !originalStory.closeFriendsOnly);
  // Media authorization must use the original object's owner and content id.
  const sourcePost = liveStory.repostOfPostId ? state.posts.find(p => p.id === liveStory.repostOfPostId) : undefined;
  const isPostRepost = Boolean(liveStory.repostOfPostId);
  const postAuthor = sourcePost ? state.characters.find(account => account.id === sourcePost.authorId) : undefined;
  const canOpenPost = Boolean(sourcePost && postAuthor && !postAuthor.privateAccount && !postAuthor.archived);
  const mediaOwner = originalStory ?? liveStory;
  const storyMediaSource = sourcePost
    ? { sourceUniverseId: universeId, sourceCharacterId: sourcePost.authorId, sourceType: 'post' as const, sourceContentId: sourcePost.id }
    : { sourceUniverseId: universeId, sourceCharacterId: mediaOwner.authorId, sourceType: 'story' as const, sourceContentId: mediaOwner.id };
  const canShowMedia = (!isPostRepost || canOpenPost) && (!isStoryRepost || canShowOriginalStory);
  const storyImage = resolveMedia(canShowMedia ? mediaOwner.image : "", storyMediaSource);
  const imageIsPrivate = story.image.startsWith('/objects/') || story.image.startsWith('/api/storage/objects/');
  // A private image can take a few seconds to resolve on mobile. Loading is not an error.
  useEffect(() => {
    setStoryImageWaitExpired(false);
    setFailedStoryImage(null);
    const timer = window.setTimeout(() => setStoryImageWaitExpired(true), 15000);
    return () => window.clearTimeout(timer);
  }, [story.id]);
  const imageUnavailable = Boolean(story.image) && (!storyImage || failedStoryImage === story.id);
  const showImageError = imageUnavailable && (failedStoryImage === story.id || storyImageWaitExpired);
  const retryStoryImage = () => {
    setFailedStoryImage(null);
    retryPrivateMedia(mediaOwner.image, storyMediaSource);
  };

  useEffect(() => {
    actions.seeStory(story.id);
  }, [story.id, actions]);

  const next = useCallback(() => {
    setReply('');
    if (si < group.stories.length - 1) setSi(si + 1);
    else if (gi < groups.length - 1) {
      setGi(gi + 1);
      setSi(0);
    } else onClose();
  }, [si, gi, group.stories.length, groups.length, onClose]);

  const prev = useCallback(() => {
    setReply('');
    if (si > 0) setSi(si - 1);
    else if (gi > 0) {
      const pg = groups[gi - 1];
      setGi(gi - 1);
      setSi(pg.stories.length - 1);
    } else setSi(0);
  }, [si, gi, groups]);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (editingMetrics) return;
      if (document.activeElement === inputRef.current) {
        if (e.key === 'Escape') inputRef.current?.blur();
        return;
      }
      if (e.key === 'Escape') onClose();
      if (e.key === 'ArrowRight') next();
      if (e.key === 'ArrowLeft') prev();
    };
    window.addEventListener('keydown', onKey);
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = '';
    };
  }, [next, prev, onClose, editingMetrics]);

  // Grow the story composer up to six lines, then scroll inside it.
  // Unlike a single-line input, a textarea preserves paragraph breaks in DMs.
  useEffect(() => {
    const field = inputRef.current;
    if (!field) return;
    field.style.height = '48px';
    field.style.height = `${Math.min(Math.max(field.scrollHeight, 48), 176)}px`;
  }, [reply, story.id]);

  const isPaused = paused || replyFocused || reply.length > 0 || showViewers || showShare || editingMetrics || confirmDelete || (imageIsPrivate && imageUnavailable);

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    actions.sendMessage(group.author.id, reply, { storyId: story.id });
    setReply('');
    inputRef.current?.blur();
    setReplyFocused(false);
    toast({ title: `${t('Respuesta enviada a')} ${group.author.name.split(' ')[0]}`, description: t('La encontrarás en Mensajes.') });
  };

  const viewers = storyViewerIds(liveStory).map(character).filter(Boolean);
  const likedViewerIds = new Set(liveStory.likes ?? []);
  const viewerRows = (viewerFilter === 'likes' ? [...likedViewerIds] : storyViewerIds(liveStory).filter(id => !likedViewerIds.has(id))).map(character).filter((v): v is NonNullable<typeof v> => !!v);
  const totalViews = storyViewCount(liveStory);
  const active = isStoryActive(liveStory);
  const mentioned = (liveStory.mentionedAccountIds ?? []).map(character).filter((c): c is NonNullable<typeof c> => !!c);
  const hasLiked = (liveStory.likes ?? []).includes(me.id);
  // Require accepted follows in both directions, not merely a visible profile.
  const mutualFollow = (a: string, b: string) => (state.follows[a] ?? []).includes(b) && (state.follows[b] ?? []).includes(a);
  const shareTargets = state.characters.filter(c => !c.archived && c.id !== me.id && mutualFollow(me.id, c.id) && mutualFollow(liveStory.authorId, c.id) && canViewStory(liveStory, c.id, state) && (c.name + ' ' + c.handle).toLowerCase().includes(shareSearch.toLowerCase()));
  const shareWith = async (targetId: string) => {
    if (!isStoryActive(liveStory) || !mutualFollow(me.id, targetId) ||
        !mutualFollow(liveStory.authorId, targetId) || !canViewStory(liveStory, targetId, state)) return;
    try {
      const result = await customFetch<{ allowed: boolean }>('/api/stories/authorize-share', {
        method: 'POST', responseType: 'json',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId, senderId: me.id, recipientId: targetId, storyId: liveStory.id }),
      });
      if (!result.allowed) throw new Error('Forbidden');
      actions.sendMessage(targetId, '', { storyId: liveStory.id });
      setShowShare(false);
      setShareSearch('');
      toast({ title: t('Historia compartida') });
    } catch {
      toast({ title: t('No se pudo compartir'), description: 'No se pudo verificar el permiso de compartir esta historia.' });
    }
  };
  const canRepost = canRepostMentionedStory(liveStory, me.id, state) &&
    !state.characters.find(c => c.id === liveStory.authorId)?.privateAccount && !liveStory.closeFriendsOnly;
  const repostToMyStory = async () => {
    if (!canRepost || reposting) return;
    setReposting(true);
    try {
      const result = await customFetch<{ allowed: boolean }>('/api/stories/authorize-repost', {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ universeId, actorId: me.id, storyId: liveStory.id }),
      });
      if (!result.allowed) throw new Error('No autorizado');
      actions.repostMentionedStory(liveStory.id, repostCaption);
      toast({ title: 'Historia agregada', description: 'Compartida con crédito a la historia original.' });
      setRepostComposerOpen(false);
      setRepostCaption('');
      onClose();
    } catch (error) {
      toast({ title: 'No se pudo repostear', description: (error as Error).message });
    } finally { setReposting(false); }
  };
  const myReaction = liveStory.reactions?.find((r) => r.actorId === me.id)?.value;
  const react = (value: string) => {
    try {
      actions.reactStory(story.id, value);
      if (myReaction !== value) toast({ title: `${t('Reacción enviada a')} ${group.author.name.split(' ')[0]}`, description: t('También llega como mensaje directo.') });
    } catch (e) { toast({ title: t('No se pudo reaccionar'), description: (e as Error).message }); }
  };

  return (
    <motion.div
      onTouchStart={(e) => { if (isMine && !showViewers) swipeStartY.current = e.touches[0]?.clientY ?? null; }}
      onTouchEnd={(e) => { if (isMine && swipeStartY.current !== null && swipeStartY.current - (e.changedTouches[0]?.clientY ?? swipeStartY.current) > 65) setShowViewers(true); swipeStartY.current = null; }}
      className="echo-dark-surface fixed inset-0 z-[70] flex items-center justify-center bg-[hsl(240_8%_3%)] text-foreground"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.22 }}
      role="dialog"
      aria-label={`${t("Historias de")} ${group.author.name}`}
      data-testid="story-viewer"
    >
      <button
        onClick={prev}
        aria-label={t("Historia anterior")}
        className="absolute left-[calc(50%-290px)] top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-secondary/80 hover:bg-secondary md:grid"
        data-testid="button-story-prev-desktop"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={next}
        aria-label={t("Historia siguiente")}
        className="absolute right-[calc(50%-290px)] top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-secondary/80 hover:bg-secondary md:grid"
        data-testid="button-story-next-desktop"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div className="relative flex h-[100dvh] w-full max-w-[480px] flex-col md:h-[min(92dvh,860px)] md:overflow-hidden md:rounded-[28px]">
        {storyImage && !isPostRepost && !isStoryRepost && (
          <img
            key={story.id}
            src={storyImage}
            onLoad={() => setFailedStoryImage(current => current === story.id ? null : current)}
            onError={() => setFailedStoryImage(story.id)}
            alt={story.caption || `${t("Historia de")} ${group.author.name}`}
            className="fade-up absolute inset-0 h-full w-full object-contain md:object-cover"
            draggable={false}
            data-testid={`img-story-${story.id}`}
          />
        )}
        {isPostRepost && (
          <div className="pointer-events-none absolute inset-0 z-[1] flex flex-col items-center justify-center gap-3 overflow-hidden bg-[#19171d] px-7 pt-20 pb-32">
            {storyImage && <img src={storyImage} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full scale-110 object-cover opacity-30 blur-2xl" />}
            {sourcePost && postAuthor && canOpenPost ? (
              <button type="button" onClick={() => { onClose(); navigate(`/p/${encodeURIComponent(sourcePost.id)}`); }} className="pointer-events-auto relative w-full max-w-[350px] overflow-hidden rounded-2xl border border-white/15 bg-[#18151d] text-left text-white shadow-xl focus-visible:ring-2 focus-visible:ring-white" data-testid="button-story-repost-card" aria-label={`Abrir publicación original de @${postAuthor.handle}`}>
                <div className="flex items-center gap-2.5 px-3 py-2.5">
                  <CharacterAvatar character={postAuthor} size={28} />
                  <span className="min-w-0 truncate text-sm font-semibold">@{postAuthor.handle}</span>
                  <VerifiedBadge account={postAuthor} className="h-3.5 w-3.5" />
                </div>
                {storyImage && <img src={storyImage} onLoad={() => setFailedStoryImage(current => current === story.id ? null : current)} onError={() => setFailedStoryImage(story.id)} alt="Publicación compartida" className="max-h-[43dvh] w-full object-contain" />}
                <div className="px-3 py-2.5 text-xs text-white/75">Ver publicación original ↗</div>
              </button>
            ) : <p className="relative text-center text-sm text-white/80">La publicación original no está disponible.</p>}
            {story.caption && <p className="relative line-clamp-3 max-w-[350px] break-words text-center text-sm text-white"><SocialText text={story.caption} onNavigate={onClose} /></p>}
          </div>
        )}
        {isStoryRepost && (
          <div className="pointer-events-none absolute inset-x-0 top-[max(76px,calc(env(safe-area-inset-top)+56px))] bottom-[max(124px,calc(env(safe-area-inset-bottom)+110px))] z-[1] flex flex-col items-center justify-center gap-3 px-7">
            {storyImage && <img src={storyImage} alt="" aria-hidden="true" className="absolute inset-0 h-full w-full object-cover opacity-25 blur-2xl" />}
            {canShowOriginalStory && originalStory && originalAuthor ? (
              <div className="pointer-events-auto relative min-h-0 w-full max-w-[350px] overflow-y-auto rounded-2xl border border-white/15 bg-[#18151d] text-white shadow-xl" data-testid="story-repost-source-card">
                <button type="button" onClick={() => { onClose(); navigate(`/profile/${encodeURIComponent(originalAuthor.id)}`); }} className="flex w-full items-center gap-2.5 px-3 py-2.5 text-left text-sm font-semibold" data-testid="story-repost-credit">
                  <CharacterAvatar character={originalAuthor} size={28} />
                  <span className="truncate">@{originalAuthor.handle}</span>
                </button>
                {storyImage && <img src={storyImage} onLoad={() => setFailedStoryImage(null)} onError={() => setFailedStoryImage(story.id)} alt="Historia original" className="max-h-[35dvh] w-full object-contain" />}
                {originalStory.caption && <p className="whitespace-pre-wrap break-words px-3 py-2.5 text-sm" data-testid="story-repost-original-caption"><SocialText text={originalStory.caption} onNavigate={onClose} /></p>}
              </div>
            ) : <p className="relative text-center text-sm text-white/80">La historia original no está disponible.</p>}
            {story.caption && <p className="pointer-events-auto relative max-h-[15dvh] w-full max-w-[350px] shrink-0 overflow-y-auto whitespace-pre-wrap break-words rounded-xl bg-black/55 px-3 py-2 text-center text-sm text-white" data-testid="story-repost-added-caption"><SocialText text={story.caption} onNavigate={onClose} /></p>}
          </div>
        )}
        {canShowMedia && imageIsPrivate && imageUnavailable && !showImageError && (
          <div className="absolute inset-0 z-[5] flex items-center justify-center bg-black/40" role="status" aria-label="Cargando imagen">
            <div className="h-8 w-8 animate-spin rounded-full border-2 border-white/20 border-t-white/80" />
          </div>
        )}
        {canShowMedia && imageIsPrivate && showImageError && (
          <div className="absolute inset-0 z-[5] flex flex-col items-center justify-center gap-3 bg-black/70 px-8 text-center text-white" role="status">
            <p className="text-sm">La foto de esta historia todavía no está disponible.</p>
            <button type="button" onClick={retryStoryImage} className="rounded-full border border-white/50 px-5 py-2 text-sm font-medium">Reintentar imagen</button>
          </div>
        )}
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[hsl(240_8%_3%/0.75)] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[hsl(240_8%_3%/0.85)] to-transparent" />

        {repostComposerOpen && (
          <div className="absolute inset-0 z-40 flex items-center justify-center bg-black/90 px-5 py-10" data-testid="composer-mentioned-story-repost">
            <div className="flex w-full max-w-[380px] flex-col gap-4 rounded-2xl bg-card p-4">
              <div className="text-base font-semibold">Compartir en mi historia</div>
              <div className="relative mx-auto flex max-h-[48dvh] w-full flex-col overflow-y-auto rounded-xl bg-black p-3">
                <div className="w-full rounded-xl border border-white/20 bg-[#18161c] p-2">
                  <div className="flex items-center gap-2 pb-2 text-xs font-semibold text-white"><CharacterAvatar character={group.author} size={24} />@{group.author.handle}</div>
                  {storyImage && <img src={storyImage} alt="Historia original" className="max-h-[31dvh] w-full object-contain" />}
                  {liveStory.caption && <p className="mt-2 whitespace-pre-wrap break-words text-sm text-white">{liveStory.caption}</p>}
                </div>
                {repostCaption.trim() && <p className="mt-3 break-words text-center text-sm text-white">{repostCaption}</p>}
              </div>
              <textarea value={repostCaption} onChange={e => setRepostCaption(e.target.value.slice(0, 500))} maxLength={500} rows={3} placeholder="Agregá tu propio texto..." aria-label="Texto para la historia compartida" className="w-full resize-none rounded-xl border border-border bg-secondary p-3 text-sm" data-testid="input-mentioned-story-repost-caption" />
              <div className="flex gap-2">
                <button type="button" onClick={() => setRepostComposerOpen(false)} className="h-11 flex-1 rounded-xl border border-border text-sm">Cancelar</button>
                <button type="button" disabled={reposting} onClick={() => void repostToMyStory()} className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-publish-mentioned-story-repost">{reposting ? 'Publicando…' : 'Publicar historia'}</button>
              </div>
            </div>
          </div>
        )}

        {/* progress */}
        <div className="relative z-10 flex gap-1 px-3 pt-[max(env(safe-area-inset-top),12px)]">
          {group.stories.map((s, i) => (
            <div key={s.id} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-[hsl(0_0%_100%/0.25)]">
              {i < si && <div className="h-full w-full bg-foreground" />}
              {i === si && (
                <div
                  key={`${group.author.id}-${s.id}`}
                  className="story-progress h-full w-full bg-foreground"
                  style={{ animationDuration: `${storyDurationMs}ms`, animationPlayState: isPaused ? 'paused' : 'running' }}
                  onAnimationEnd={next}
                />
              )}
            </div>
          ))}
        </div>

        <div className="relative z-10 flex items-center gap-3 px-4 pt-3">
          <button
            onClick={() => {
              onClose();
              navigate(`/profile/${group.author.id}`);
            }}
            className="flex min-w-0 items-center gap-2.5"
            data-testid="link-story-author"
          >
            <CharacterAvatar character={group.author} size={34} />
            <span className="truncate text-sm font-semibold">{group.author.handle}</span><VerifiedBadge account={group.author} className="h-3.5 w-3.5" />
            <span className="text-sm text-foreground/60">{timeAgo(story.createdAt)}</span>
          </button>
          {liveStory.closeFriendsOnly && <span className="ml-auto rounded-full bg-primary px-2 py-1 text-[10px] font-semibold text-primary-foreground" data-testid="badge-close-friends-story">★ {t("Mejores amigos")}</span>}
          {isMine && <button type="button" onClick={() => setConfirmDelete(true)} aria-label={t("Eliminar historia")} title={t("Eliminar historia")} className="tap grid h-11 w-11 place-items-center rounded-full text-foreground" data-testid="button-story-delete"><Trash2 className="h-5 w-5" /></button>}
          <button
            onClick={onClose}
            className="tap grid h-11 w-11 place-items-center rounded-full"
            aria-label={t("Cerrar historias")}
            data-testid="button-story-close"
          >
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </div>

        {canRepost && <button type="button" disabled={reposting} onClick={() => setRepostComposerOpen(true)} className="absolute right-4 top-24 z-20 rounded-full border border-white/30 bg-black/65 px-4 py-2 text-xs font-semibold text-white backdrop-blur disabled:opacity-50" data-testid="button-story-repost">{reposting ? 'Compartiendo…' : 'Agregar a mi historia'}</button>}
        {showShare && <div className="absolute inset-0 z-40 flex items-end justify-center bg-black/70 p-3 sm:items-center" role="dialog" aria-modal="true" aria-label={t('Compartir historia')}>
          <div className="flex max-h-[75dvh] w-full max-w-md flex-col overflow-hidden rounded-3xl bg-card p-4 text-foreground" data-testid="story-share-picker">
            <div className="mb-3 flex items-center justify-between"><h2 className="text-lg font-semibold">{t('Compartir historia')}</h2><button type="button" className="grid h-10 w-10 place-items-center rounded-full hover:bg-secondary" onClick={() => setShowShare(false)} aria-label={t('Cerrar')}><X size={20}/></button></div>
            <input value={shareSearch} onChange={e => setShareSearch(e.target.value)} placeholder={t('Buscar personaje')} aria-label={t('Buscar personaje')} className="mb-3 h-11 w-full rounded-xl border border-border bg-background px-3 text-sm" />
            <div className="min-h-0 flex-1 space-y-1 overflow-y-auto">{shareTargets.length === 0 ? <p className="py-8 text-center text-sm text-muted-foreground">{t('No hay personajes disponibles para compartir esta historia.')}</p> : shareTargets.map(target => <button type="button" key={target.id} onClick={() => void shareWith(target.id)} className="flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left hover:bg-secondary" data-testid={`share-story-with-${target.id}`}><CharacterAvatar character={target} size={40}/><span className="min-w-0 flex-1 truncate text-sm font-medium">{target.name} <span className="text-muted-foreground">@{target.handle}</span></span><Send size={18} className="text-primary"/></button>)}</div>
            <p className="mt-3 text-xs text-muted-foreground">{t('Solo aparecen personajes que se siguen mutuamente y pueden ver esta historia.')}</p>
          </div>
        </div>}
        {confirmDelete && <div className="absolute inset-0 z-30 flex items-center justify-center bg-black/80 px-6" role="alertdialog" aria-modal="true" aria-label={t("Eliminar historia")}>
          <div className="w-full max-w-sm rounded-3xl bg-card p-5 text-foreground">
            <h2 className="text-lg font-semibold">{t("¿Eliminar esta historia?")}</h2>
            <p className="mt-2 text-sm text-muted-foreground">{t("También se quitará de las destacadas que la incluyan. No se puede deshacer.")}</p>
            <div className="mt-5 flex gap-2">
              <button type="button" onClick={() => setConfirmDelete(false)} className="h-11 flex-1 rounded-xl bg-secondary text-sm" data-testid="button-story-delete-cancel">{t("Cancelar")}</button>
              <button type="button" onClick={() => { try { actions.deleteStory(story.id); toast({ title: t('Historia eliminada') }); onClose(); } catch (e) { toast({ title: t('No se pudo eliminar'), description: (e as Error).message }); } }} className="h-11 flex-1 rounded-xl bg-destructive text-sm font-semibold text-destructive-foreground" data-testid="button-story-delete-confirm">{t("Eliminar")}</button>
            </div>
          </div>
        </div>}
        {/* tap zones */}
        <div className="relative z-0 flex flex-1">
          <button
            className="h-full w-1/3"
            aria-label={t("Anterior")}
            onClick={prev}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerLeave={() => setPaused(false)}
            data-testid="button-story-prev"
          />
          <button
            className="h-full w-2/3"
            aria-label={t("Siguiente")}
            onClick={next}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerLeave={() => setPaused(false)}
            data-testid="button-story-next"
          />
        </div>

        <div className="pointer-events-none absolute inset-x-0 bottom-[calc(max(env(safe-area-inset-bottom),14px)+112px)] z-10 flex max-h-[38dvh] flex-col items-center gap-3 overflow-y-auto px-6 text-center">
          {liveStory.musicClip && <div className="pointer-events-auto max-w-[80%] min-w-0"><MusicClipPlayer key={liveStory.id} clip={liveStory.musicClip} compact autoPlay artist={liveStory.music?.artist} source={{ universeId, surface: 'story', contentId: liveStory.id, viewerUniverseId: universeId, viewerCharacterId: me.id }} /></div>}
          {liveStory.music && !liveStory.musicClip && (
            <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-[hsl(240_8%_3%/0.6)] px-3 py-1.5 text-xs backdrop-blur" title={t("Solo metadatos: no se reproduce audio")} data-testid={`text-story-music-${story.id}`}>
              <Music2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate"><b className="font-semibold">{liveStory.music.title}</b> · {liveStory.music.artist}</span>
              <span className="shrink-0 rounded-full bg-foreground/15 px-1.5 text-[10px] uppercase tracking-wider">{t("sin audio")}</span>
            </span>
          )}
          
          {!isPostRepost && !isStoryRepost && story.caption && (
            <p className="max-w-full break-words font-display text-base font-light leading-relaxed text-foreground/95 sm:text-lg"><SocialText text={story.caption} onNavigate={onClose} /></p>
          )}
          {mentioned.length > 0 && (
            <div className="flex flex-wrap justify-center gap-1.5">
              {mentioned.map((c) => (
                <button key={c.id} type="button" onClick={() => { onClose(); navigate(`/profile/${c.id}`); }} className="pointer-events-auto inline-flex h-8 items-center gap-1 rounded-full bg-[hsl(240_8%_3%/0.6)] px-3 text-xs font-semibold backdrop-blur" data-testid={`button-story-mention-${c.id}`}>
                  <AtSign className="h-3 w-3" />{c.handle}
                </button>
              ))}
            </div>
          )}
          {!active && <span className="rounded-full bg-[hsl(240_8%_3%/0.6)] px-2.5 py-1 text-[11px] text-foreground/75" data-testid="status-story-archived">{t("Archivada · ya no aparece en el carrusel")}</span>}
        </div>

        <div className="relative z-10 px-3 pb-[max(env(safe-area-inset-bottom),14px)] pt-2">
          {isMine ? (
            <div className="relative">
              <button
                onClick={() => { setViewerFilter('views'); setShowViewers((v) => !v); }}
                className="flex h-11 items-center gap-2 rounded-full px-3 text-sm text-foreground/85"
                data-testid="button-story-viewers"
              >
                <Eye className="h-5 w-5" strokeWidth={1.6} />
                {totalViews === 0 ? t('Nadie la ha visto todavía') : `${t('Vista por')} ${formatCount(totalViews)}`}{liveStory.reactions?.length ? ` · ${liveStory.reactions.length} ${t("reacción(es)")}` : ''}{liveStory.likes?.length ? ` · ${liveStory.likes.length} ${t("Me gusta")}` : ''}
              </button>
              <StoryMetricsEditor key={story.id} story={liveStory} onOpenChange={open => setEditingMetricsId(open ? story.id : null)} />
              {showViewers && (
                <div className="absolute bottom-0 left-0 right-0 z-30 max-h-[65dvh] overflow-hidden rounded-t-3xl border border-white/10 bg-card/95 shadow-2xl backdrop-blur-xl" data-testid="story-viewers-sheet">
                  <div className="flex items-center justify-between border-b border-border px-4 py-3">
                    <div className="flex items-center gap-3 text-sm font-semibold">
                      <span className="flex items-center gap-1"><Eye className="h-4 w-4" />{formatCount(totalViews)}</span>
                      <span className="flex items-center gap-1"><Heart className="h-4 w-4 text-red-500" fill="currentColor" />{liveStory.likes?.length ?? 0}</span>
                    </div>
                    <button type="button" onClick={() => setShowViewers(false)} className="grid h-9 w-9 place-items-center rounded-full bg-secondary" aria-label={t("Cerrar")} data-testid="button-story-viewers-close"><ChevronDown className="h-5 w-5" /></button>
                  </div>
                  <div className="max-h-[calc(65dvh-64px)] overflow-y-auto overscroll-contain p-3">
                    {viewerRows.length === 0 ? <p className="py-5 text-center text-sm text-muted-foreground">{viewerFilter === 'likes' ? t('Me gusta') + ': 0' : t('Nadie la ha visto todavía')}</p> : viewerRows.map(v => (
                      <div key={v.id} className="flex items-center gap-3 rounded-xl px-2 py-2 text-sm" data-testid={`story-viewer-row-${v.id}`}>
                        <CharacterAvatar character={v} size={38} />
                        <span className="min-w-0 flex-1 truncate font-medium">{v.handle}</span>
                        {liveStory.reactions?.find(r => r.actorId === v.id) && <span className="text-lg">{liveStory.reactions.find(r => r.actorId === v.id)!.value}</span>}
                        {likedViewerIds.has(v.id) && <Heart className="h-5 w-5 shrink-0 text-red-500" fill="currentColor" aria-label={t('Me gusta')} data-testid={`story-liked-by-${v.id}`} />}
                      </div>
                    ))}
                  </div>
                </div>
              )}
            </div>
          ) : (
            <div>
            {active && (
              <div className="mb-2 flex justify-center gap-1" role="group" aria-label={t("Reaccionar a la historia")}>
                {STORY_REACTIONS.map((r, i) => (
                  <button key={r} type="button" onClick={() => react(r)} aria-pressed={myReaction === r}
                    className={cn('tap grid h-10 w-10 place-items-center rounded-full text-xl', myReaction === r ? 'bg-primary/30' : 'bg-[hsl(240_8%_3%/0.35)]')}
                    data-testid={`button-story-reaction-${i}`}>{r}</button>
                ))}
              </div>
            )}
            <MentionSuggestions text={reply} onPick={setReply} excludeId={me.id} className="mb-2" />
            <form onSubmit={submit} className="flex items-end gap-2">
              <textarea
                ref={inputRef}
                rows={1}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onFocus={() => setReplyFocused(true)}
                onBlur={() => setReplyFocused(false)}
                onKeyDown={(e) => {
                  if (e.key === 'Enter' && (e.ctrlKey || e.metaKey)) {
                    e.preventDefault();
                    e.currentTarget.form?.requestSubmit();
                  }
                }}
                placeholder={`${t("Responder a")} ${group.author.name.split(' ')[0]}…`}
                className="min-h-12 min-w-0 flex-1 resize-none overflow-y-auto rounded-3xl border border-[hsl(0_0%_100%/0.3)] bg-transparent px-5 py-3 text-[15px] leading-6 text-foreground placeholder:text-foreground/60 focus:border-foreground/70 focus:outline-none"
                data-testid="input-story-reply"
                aria-label={t("Responder a la historia")}
              />
              {active && <button type="button" onClick={() => actions.toggleStoryLike(story.id)} aria-label={hasLiked ? t('Quitar me gusta') : t('Me gusta')} aria-pressed={hasLiked} title={hasLiked ? t('Quitar me gusta') : t('Me gusta')} className={cn('tap grid h-12 w-12 shrink-0 place-items-center rounded-full', hasLiked ? 'text-red-500' : 'text-foreground')} data-testid="button-story-like"><Heart className="h-7 w-7" fill={hasLiked ? 'currentColor' : 'none'} strokeWidth={1.8} /></button>}
              {active && !reply.trim() && <button type="button" onClick={() => setShowShare(true)} aria-label={t("Compartir historia")} title={t("Compartir historia")} className="tap grid h-12 w-12 shrink-0 place-items-center rounded-full" data-testid="button-story-share"><Send className="h-6 w-6" strokeWidth={1.8}/></button>}
              {reply.trim() && <button
                type="submit"
                disabled={!reply.trim()}
                aria-label={t("Enviar respuesta")}
                className={cn('tap grid h-12 w-12 place-items-center rounded-full transition-opacity', reply.trim() ? 'opacity-100' : 'opacity-40')}
                data-testid="button-story-reply-send"
              >
                <Send className="h-6 w-6" strokeWidth={1.6} />
              </button>}
            </form>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
