import { Link } from 'wouter';
import { Copy, Heart, MessageCircle, Pin, Play } from 'lucide-react';
import { postMedia } from '@/domain/post-media';
import { useSocial } from '@/store/social-store';
import { resolveMedia } from '@/lib/media';
import type { Post } from '@/domain/types';

/** Prefer the first photo as cover; videos render a metadata-preloaded frame, never a broken img. */
const cover = (p: Post) => {
  const media = postMedia(p);
  return media.find((m) => m.type === 'image') ?? media[0];
};

export function PhotoGrid({ posts, showPinned = false }: { posts: Post[]; showPinned?: boolean }) {
  const { state } = useSocial();
  return (
    <div className="grid grid-cols-3 gap-[3px] sm:gap-1.5">
      {posts.map((p) => {
        const comments = state.comments.filter((c) => c.postId === p.id).length;
        return (
          <Link key={p.id} href={`/p/${p.id}`} className="group relative block overflow-hidden bg-card sm:rounded-xl" data-testid={`link-grid-post-${p.id}`}>
            {cover(p).type === 'video' ? (
              <video src={`${resolveMedia(cover(p).url)}#t=0.1`} muted playsInline preload="metadata" aria-label={p.caption || 'Video'} className="pointer-events-none aspect-[4/5] w-full bg-black object-cover" data-testid={`video-grid-post-${p.id}`} />
            ) : (
              <img src={resolveMedia(cover(p).url)} alt={p.caption} loading="lazy" className="aspect-[4/5] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
            )}
            <span className="pointer-events-none absolute right-1.5 top-1.5 flex gap-1 drop-shadow">
              {showPinned && p.pinned && <Pin className="h-4 w-4 fill-foreground" aria-label="Fijada" data-testid={`status-grid-pinned-${p.id}`} />}
              {postMedia(p).length > 1 ? <Copy className="h-4 w-4" aria-label="Carrusel" /> : cover(p).type === 'video' && <Play className="h-4 w-4 fill-foreground" aria-label="Video" />}
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
