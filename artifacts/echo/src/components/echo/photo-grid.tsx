import { useEffect, useMemo, useState } from 'react';
import { Link } from 'wouter';
import { Copy, Heart, MessageCircle, Pin, Play } from 'lucide-react';
import { postMedia } from '@/domain/post-media';
import { useSocial } from '@/store/social-store';
import { useMediaResolver } from '@/lib/media';
import type { Post } from '@/domain/types';

export function PhotoGrid({ posts, showPinned = false }: { posts: Post[]; showPinned?: boolean }) {
  const resolveMedia = useMediaResolver();
  const { state } = useSocial();
  const initialImageIds = useMemo(() => posts.slice(0, 12)
    .filter(p => postMedia(p).some(item => item.type === 'image'))
    .map(p => p.id), [posts]);
  const [readyIds, setReadyIds] = useState<Set<string>>(() => new Set());
  const [batchTimeout, setBatchTimeout] = useState(false);
  const batchKey = initialImageIds.join('|');
  useEffect(() => {
    setReadyIds(new Set());
    setBatchTimeout(false);
    const timer = window.setTimeout(() => setBatchTimeout(true), 12000);
    return () => window.clearTimeout(timer);
  }, [batchKey]);
  const batchReady = batchTimeout || initialImageIds.every(id => readyIds.has(id));
  const markReady = (id: string) => setReadyIds(previous => {
    if (previous.has(id)) return previous;
    const next = new Set(previous);
    next.add(id);
    return next;
  });
  return (
    <div className="grid grid-cols-3 gap-[3px] sm:gap-1.5">
      {posts.map((p) => {
        const comments = state.comments.filter((c) => c.postId === p.id).length;
        const media = postMedia(p);
        const cover = media.find((item) => item.type === 'image') ?? media[0];
        const inInitialBatch = initialImageIds.includes(p.id);
        const holdImage = inInitialBatch && !batchReady;
        return (
          <Link key={p.id} href={`/p/${p.id}`} className="group relative block overflow-hidden bg-card sm:rounded-xl" data-testid={`link-grid-post-${p.id}`}>
            {!cover ? (
              <div className="grid aspect-[4/5] place-items-center px-3 py-2 text-center text-xs leading-snug text-muted-foreground" data-testid={`text-grid-post-${p.id}`}>
                <span className="line-clamp-7">{p.caption || 'Publicación de texto'}</span>
              </div>
            ) : cover.type === 'video' ? (
              <video src={`${resolveMedia(cover.url, { sourceType: 'post', sourceContentId: p.id })}#t=0.1`} muted playsInline preload="metadata" aria-label={p.caption || 'Video'} className="pointer-events-none aspect-[4/5] w-full bg-black object-cover" data-testid={`video-grid-post-${p.id}`} />
            ) : (
              <>
                <div className={`absolute inset-0 animate-pulse bg-secondary ${holdImage ? '' : 'hidden'}`} aria-hidden="true" />
                <img
                  src={resolveMedia(cover.url, { sourceType: 'post', sourceContentId: p.id })}
                  alt={p.caption}
                  loading={inInitialBatch ? 'eager' : 'lazy'}
                  onLoad={() => markReady(p.id)}
                  onError={() => markReady(p.id)}
                  className={`aspect-[4/5] w-full object-cover transition-opacity duration-300 ${holdImage ? 'opacity-0' : 'opacity-100'}`}
                />
              </>
            )}
            <span className="pointer-events-none absolute right-1.5 top-1.5 flex gap-1 drop-shadow">
              {showPinned && p.pinned && <Pin className="h-4 w-4 fill-foreground" aria-label="Fijada" data-testid={`status-grid-pinned-${p.id}`} />}
              {media.length > 1 ? <Copy className="h-4 w-4" aria-label="Carrusel" /> : cover?.type === 'video' && <Play className="h-4 w-4 fill-foreground" aria-label="Video" />}
            </span>
            <div className="absolute inset-0 hidden items-center justify-center gap-4 bg-[hsl(240_8%_3%/0.45)] text-sm font-semibold opacity-0 transition-opacity group-hover:opacity-100 md:flex">
              <span className="flex items-center gap-1.5"><Heart className="h-4 w-4 fill-foreground" /> {p.likes.length}</span>
              <span className="flex items-center gap-1.5"><MessageCircle className="h-4 w-4 fill-foreground" /> {comments}</span>
            </div>
          </Link>
        );
      })}
    </div>
  );
}
