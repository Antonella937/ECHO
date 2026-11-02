import { Link } from 'wouter';
import { Heart, MessageCircle } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { resolveMedia } from '@/lib/media';
import type { Post } from '@/domain/types';

export function PhotoGrid({ posts }: { posts: Post[] }) {
  const { state } = useSocial();
  return (
    <div className="grid grid-cols-3 gap-[3px] sm:gap-1.5">
      {posts.map((p) => {
        const comments = state.comments.filter((c) => c.postId === p.id).length;
        return (
          <Link key={p.id} href={`/p/${p.id}`} className="group relative block overflow-hidden bg-card sm:rounded-xl" data-testid={`link-grid-post-${p.id}`}>
            <img src={resolveMedia(p.image)} alt={p.caption} loading="lazy" className="aspect-[4/5] w-full object-cover transition-transform duration-500 group-hover:scale-[1.03]" />
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
