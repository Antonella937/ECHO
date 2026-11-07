import { MusicClipPlayer } from './music-clip-player';
import { useStoryViewerText } from '@/lib/story-viewer-translations';
import { VerifiedBadge } from './verified-badge';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { AtSign, ChevronLeft, ChevronRight, Eye, Heart, Music2, Send, Trash2, X } from 'lucide-react';
import { canViewStory, isStoryActive } from '@/domain/social-features';
import { storyViewCount, storyViewerIds, formatCount } from '@/domain/accounts';
import { StoryMetricsEditor } from './story-metrics-editor';
import { SocialText } from './social-text';
import { MentionSuggestions } from './mention-suggestions';

const STORY_REACTIONS = ['❤', '😂', '😮', '😢', '🔥', '👏'];
import { useLocation } from 'wouter';
import { useSocial } from '@/store/social-store';
import { useStoryGroups, type StoryGroup } from '@/hooks/use-social-selectors';
import { useMediaResolver, timeAgo } from '@/lib/media';
import { CharacterAvatar } from './avatar';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const DURATION = 10000;

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
  const { me, actions, state, character } = useSocial();
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
  const [confirmDelete, setConfirmDelete] = useState(false);
  const [editingMetricsId, setEditingMetricsId] = useState<string | null>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  const group = groups[Math.min(gi, groups.length - 1)];
  const story = group.stories[Math.min(si, group.stories.length - 1)];
  const isMine = group.author.id === me.id;
  const liveStory = state.stories.find((s) => s.id === story.id) ?? story;
  const editingMetrics = editingMetricsId === story.id;

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

  const isPaused = paused || replyFocused || reply.length > 0 || showViewers || editingMetrics || confirmDelete;

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
  const totalViews = storyViewCount(liveStory);
  const active = isStoryActive(liveStory);
  const mentioned = (liveStory.mentionedAccountIds ?? []).map(character).filter((c): c is NonNullable<typeof c> => !!c);
  const hasLiked = (liveStory.likes ?? []).includes(me.id);
  const myReaction = liveStory.reactions?.find((r) => r.actorId === me.id)?.value;
  const react = (value: string) => {
    try {
      actions.reactStory(story.id, value);
      if (myReaction !== value) toast({ title: `${t('Reacción enviada a')} ${group.author.name.split(' ')[0]}`, description: t('También llega como mensaje directo.') });
    } catch (e) { toast({ title: t('No se pudo reaccionar'), description: (e as Error).message }); }
  };

  return (
    <motion.div
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
        <img
          key={story.id}
          src={resolveMedia(story.image, { sourceType: 'story', sourceContentId: story.id })}
          alt={story.caption || `${t("Historia de")} ${group.author.name}`}
          className="fade-up absolute inset-0 h-full w-full object-contain md:object-cover"
          draggable={false}
          data-testid={`img-story-${story.id}`}
        />
        <div className="pointer-events-none absolute inset-x-0 top-0 h-40 bg-gradient-to-b from-[hsl(240_8%_3%/0.75)] to-transparent" />
        <div className="pointer-events-none absolute inset-x-0 bottom-0 h-56 bg-gradient-to-t from-[hsl(240_8%_3%/0.85)] to-transparent" />

        {/* progress */}
        <div className="relative z-10 flex gap-1 px-3 pt-[max(env(safe-area-inset-top),12px)]">
          {group.stories.map((s, i) => (
            <div key={s.id} className="h-[2.5px] flex-1 overflow-hidden rounded-full bg-[hsl(0_0%_100%/0.25)]">
              {i < si && <div className="h-full w-full bg-foreground" />}
              {i === si && (
                <div
                  key={`${group.author.id}-${s.id}`}
                  className="story-progress h-full w-full bg-foreground"
                  style={{ animationDuration: `${DURATION}ms`, animationPlayState: isPaused ? 'paused' : 'running' }}
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

        <div className="pointer-events-none absolute inset-x-0 bottom-28 z-10 flex flex-col items-center gap-2 px-6 text-center">
          {liveStory.musicClip && <div className="pointer-events-auto w-full max-w-xs"><MusicClipPlayer key={liveStory.id} clip={liveStory.musicClip} compact /></div>}
          {liveStory.music && !liveStory.musicClip && (
            <span className="inline-flex max-w-full items-center gap-2 rounded-full bg-[hsl(240_8%_3%/0.6)] px-3 py-1.5 text-xs backdrop-blur" title={t("Solo metadatos: no se reproduce audio")} data-testid={`text-story-music-${story.id}`}>
              <Music2 className="h-3.5 w-3.5 shrink-0 text-primary" />
              <span className="truncate"><b className="font-semibold">{liveStory.music.title}</b> · {liveStory.music.artist}</span>
              <span className="shrink-0 rounded-full bg-foreground/15 px-1.5 text-[10px] uppercase tracking-wider">{t("sin audio")}</span>
            </span>
          )}
          {story.caption && (
            <p className="font-display text-lg font-light leading-snug text-foreground/95"><SocialText text={story.caption} onNavigate={onClose} /></p>
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
                onClick={() => setShowViewers((v) => !v)}
                className="flex h-11 items-center gap-2 rounded-full px-3 text-sm text-foreground/85"
                data-testid="button-story-viewers"
              >
                <Eye className="h-5 w-5" strokeWidth={1.6} />
                {totalViews === 0 ? t('Nadie la ha visto todavía') : `${t('Vista por')} ${formatCount(totalViews)}`}{liveStory.reactions?.length ? ` · ${liveStory.reactions.length} ${t("reacción(es)")}` : ''}{liveStory.likes?.length ? ` · ${liveStory.likes.length} ${t("Me gusta")}` : ''}
              </button>
              <StoryMetricsEditor key={story.id} story={liveStory} onOpenChange={open => setEditingMetricsId(open ? story.id : null)} />
              {showViewers && viewers.length > 0 && (
                <div className="mt-1 flex flex-col gap-2 rounded-3xl bg-card/95 p-3 backdrop-blur">
                  {viewers.map((v) =>
                    v ? (
                      <div key={v.id} className="flex items-center gap-2.5 text-sm">
                        <CharacterAvatar character={v} size={28} /> <span className="flex-1">{v.name}</span>
                        {liveStory.reactions?.find((r) => r.actorId === v.id) && <span className="text-base">{liveStory.reactions.find((r) => r.actorId === v.id)!.value}</span>}
                      </div>
                    ) : null,
                  )}
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
            <form onSubmit={submit} className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                onFocus={() => setReplyFocused(true)}
                onBlur={() => setReplyFocused(false)}
                placeholder={`${t("Responder a")} ${group.author.name.split(' ')[0]}…`}
                className="h-12 min-w-0 flex-1 rounded-full border border-[hsl(0_0%_100%/0.3)] bg-transparent px-5 text-[15px] text-foreground placeholder:text-foreground/60 focus:border-foreground/70 focus:outline-none"
                data-testid="input-story-reply"
                aria-label={t("Responder a la historia")}
              />
              {active && <button type="button" onClick={() => actions.toggleStoryLike(story.id)} aria-label={hasLiked ? t('Quitar me gusta') : t('Me gusta')} aria-pressed={hasLiked} title={hasLiked ? t('Quitar me gusta') : t('Me gusta')} className={cn('tap grid h-12 w-12 shrink-0 place-items-center rounded-full', hasLiked ? 'text-red-500' : 'text-foreground')} data-testid="button-story-like"><Heart className="h-7 w-7" fill={hasLiked ? 'currentColor' : 'none'} strokeWidth={1.8} /></button>}
              <button
                type="submit"
                disabled={!reply.trim()}
                aria-label={t("Enviar respuesta")}
                className={cn('tap grid h-12 w-12 place-items-center rounded-full transition-opacity', reply.trim() ? 'opacity-100' : 'opacity-40')}
                data-testid="button-story-reply-send"
              >
                <Send className="h-6 w-6" strokeWidth={1.6} />
              </button>
            </form>
            </div>
          )}
        </div>
      </div>
    </motion.div>
  );
}
