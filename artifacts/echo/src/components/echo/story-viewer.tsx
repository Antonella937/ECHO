import { VerifiedBadge } from './verified-badge';
import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState, type FormEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { ChevronLeft, ChevronRight, Eye, Send, X } from 'lucide-react';
import { useLocation } from 'wouter';
import { useSocial } from '@/store/social-store';
import { useStoryGroups, type StoryGroup } from '@/hooks/use-social-selectors';
import { resolveMedia, timeAgo } from '@/lib/media';
import { CharacterAvatar } from './avatar';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const DURATION = 5500;

interface ViewerCtx {
  openStories(authorId: string, onlyAuthor?: boolean): void;
}
const Ctx = createContext<ViewerCtx>({ openStories: () => {} });
export const useStoryViewer = () => useContext(Ctx);

export function StoryViewerProvider({ children }: { children: ReactNode }) {
  const groups = useStoryGroups();
  const [session, setSession] = useState<{ ids: string[]; index: number } | null>(null);

  const openStories = useCallback(
    (authorId: string, onlyAuthor = false) => {
      const ids = onlyAuthor ? [authorId] : groups.map((g) => g.author.id);
      const index = Math.max(0, ids.indexOf(authorId));
      setSession({ ids, index });
    },
    [groups],
  );

  const sessionGroups = useMemo(
    () => (session ? session.ids.map((id) => groups.find((g) => g.author.id === id)).filter((g): g is StoryGroup => !!g) : []),
    [session, groups],
  );

  return (
    <Ctx.Provider value={{ openStories }}>
      {children}
      {createPortal(
        <AnimatePresence>
          {session && sessionGroups.length > 0 && (
            <Viewer
              key="viewer"
              groups={sessionGroups}
              startIndex={Math.min(session.index, sessionGroups.length - 1)}
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
  const { me, actions, state, character } = useSocial();
  const [, navigate] = useLocation();
  const [gi, setGi] = useState(startIndex);
  const [si, setSi] = useState(() => {
    const g = groups[startIndex];
    const firstUnseen = g.stories.findIndex((s) => !s.seenBy.includes(me.id));
    return g.author.id !== me.id && firstUnseen >= 0 ? firstUnseen : 0;
  });
  const [paused, setPaused] = useState(false);
  const [reply, setReply] = useState('');
  const [showViewers, setShowViewers] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);

  const group = groups[Math.min(gi, groups.length - 1)];
  const story = group.stories[Math.min(si, group.stories.length - 1)];
  const isMine = group.author.id === me.id;
  const liveStory = state.stories.find((s) => s.id === story.id) ?? story;

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
  }, [next, prev, onClose]);

  const isPaused = paused || reply.length > 0 || showViewers;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!reply.trim()) return;
    actions.sendMessage(group.author.id, reply, { storyId: story.id });
    setReply('');
    inputRef.current?.blur();
    toast({ title: `Respuesta enviada a ${group.author.name.split(' ')[0]}`, description: 'La encontrarás en Mensajes.' });
  };

  const viewers = liveStory.seenBy.map(character).filter(Boolean);

  return (
    <motion.div
      className="fixed inset-0 z-[70] flex items-center justify-center bg-[hsl(240_8%_3%)]"
      initial={{ opacity: 0, scale: 0.98 }}
      animate={{ opacity: 1, scale: 1 }}
      exit={{ opacity: 0, scale: 0.98 }}
      transition={{ duration: 0.22 }}
      role="dialog"
      aria-label={`Historias de ${group.author.name}`}
      data-testid="story-viewer"
    >
      <button
        onClick={prev}
        aria-label="Historia anterior"
        className="absolute left-[calc(50%-290px)] top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-secondary/80 hover:bg-secondary md:grid"
        data-testid="button-story-prev-desktop"
      >
        <ChevronLeft className="h-5 w-5" />
      </button>
      <button
        onClick={next}
        aria-label="Historia siguiente"
        className="absolute right-[calc(50%-290px)] top-1/2 z-10 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full bg-secondary/80 hover:bg-secondary md:grid"
        data-testid="button-story-next-desktop"
      >
        <ChevronRight className="h-5 w-5" />
      </button>

      <div className="relative flex h-[100dvh] w-full max-w-[480px] flex-col md:h-[min(92dvh,860px)] md:overflow-hidden md:rounded-[28px]">
        <img
          key={story.id}
          src={resolveMedia(story.image)}
          alt={story.caption || `Historia de ${group.author.name}`}
          className="fade-up absolute inset-0 h-full w-full object-cover"
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
          <button
            onClick={onClose}
            className="tap ml-auto grid h-11 w-11 place-items-center rounded-full"
            aria-label="Cerrar historias"
            data-testid="button-story-close"
          >
            <X className="h-6 w-6" strokeWidth={1.6} />
          </button>
        </div>

        {/* tap zones */}
        <div className="relative z-0 flex flex-1">
          <button
            className="h-full w-1/3"
            aria-label="Anterior"
            onClick={prev}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerLeave={() => setPaused(false)}
            data-testid="button-story-prev"
          />
          <button
            className="h-full w-2/3"
            aria-label="Siguiente"
            onClick={next}
            onPointerDown={() => setPaused(true)}
            onPointerUp={() => setPaused(false)}
            onPointerLeave={() => setPaused(false)}
            data-testid="button-story-next"
          />
        </div>

        {story.caption && (
          <p className="pointer-events-none absolute inset-x-0 bottom-28 z-10 px-6 text-center font-display text-lg font-light leading-snug text-foreground/95">
            {story.caption}
          </p>
        )}

        <div className="relative z-10 px-3 pb-[max(env(safe-area-inset-bottom),14px)] pt-2">
          {isMine ? (
            <div>
              <button
                onClick={() => setShowViewers((v) => !v)}
                className="flex h-11 items-center gap-2 rounded-full px-3 text-sm text-foreground/85"
                data-testid="button-story-viewers"
              >
                <Eye className="h-5 w-5" strokeWidth={1.6} />
                {viewers.length === 0 ? 'Nadie la ha visto todavía' : `Vista por ${viewers.length}`}
              </button>
              {showViewers && viewers.length > 0 && (
                <div className="mt-1 flex flex-col gap-2 rounded-3xl bg-card/95 p-3 backdrop-blur">
                  {viewers.map((v) =>
                    v ? (
                      <div key={v.id} className="flex items-center gap-2.5 text-sm">
                        <CharacterAvatar character={v} size={28} /> {v.name}
                      </div>
                    ) : null,
                  )}
                </div>
              )}
            </div>
          ) : (
            <form onSubmit={submit} className="flex items-center gap-2">
              <input
                ref={inputRef}
                value={reply}
                onChange={(e) => setReply(e.target.value)}
                placeholder={`Responder a ${group.author.name.split(' ')[0]}…`}
                className="h-12 min-w-0 flex-1 rounded-full border border-[hsl(0_0%_100%/0.3)] bg-transparent px-5 text-[15px] text-foreground placeholder:text-foreground/60 focus:border-foreground/70 focus:outline-none"
                data-testid="input-story-reply"
                aria-label="Responder a la historia"
              />
              <button
                type="submit"
                disabled={!reply.trim()}
                aria-label="Enviar respuesta"
                className={cn('tap grid h-12 w-12 place-items-center rounded-full transition-opacity', reply.trim() ? 'opacity-100' : 'opacity-40')}
                data-testid="button-story-reply-send"
              >
                <Send className="h-6 w-6" strokeWidth={1.6} />
              </button>
            </form>
          )}
        </div>
      </div>
    </motion.div>
  );
}
