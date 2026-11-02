import { useMemo } from 'react';
import { useParams } from 'wouter';
import { Hash } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { PhotoGrid } from '@/components/echo/photo-grid';
import { EmptyState } from '@/components/echo/skeletons';
import { hashtags } from '@/domain/social-features';
import { byDateDesc } from '@/hooks/use-social-selectors';

export default function HashtagPage() {
  const { tag: raw } = useParams<{ tag: string }>();
  const tag = decodeURIComponent(raw ?? '').toLocaleLowerCase();
  const { state } = useSocial();
  const back = useBack();
  const posts = useMemo(() => state.posts.filter((p) => hashtags(p.caption).includes(tag)).sort(byDateDesc), [state.posts, tag]);
  return (
    <div>
      <TopBar title={`#${tag}`} onBack={back} />
      <div className="flex items-center gap-4 px-5 py-6">
        <span className="grid h-16 w-16 place-items-center rounded-full bg-accent text-accent-foreground"><Hash className="h-7 w-7" strokeWidth={1.6} /></span>
        <div>
          <h1 className="font-display text-xl font-medium" data-testid="text-hashtag">#{tag}</h1>
          <p className="text-sm text-muted-foreground" data-testid="text-hashtag-count">{posts.length} {posts.length === 1 ? 'publicación' : 'publicaciones'}</p>
        </div>
      </div>
      {posts.length ? <PhotoGrid posts={posts} /> : <EmptyState title="Sin publicaciones" body="Nadie en tu universo usó esta etiqueta todavía." />}
    </div>
  );
}
