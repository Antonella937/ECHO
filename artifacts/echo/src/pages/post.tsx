import { useRef, useState } from 'react';
import { byDateDesc } from '@/hooks/use-social-selectors';
import { useParams, useSearch, Link } from 'wouter';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { PostCard } from '@/components/echo/post-card';
import { CommentComposer, CommentList } from '@/components/echo/comments-panel';
import { EmptyState } from '@/components/echo/skeletons';
import { useSocial } from '@/store/social-store';
import type { Comment } from '@/domain/types';

export default function PostPage() {
  const { id } = useParams<{ id: string }>();
  const search = useSearch();
  const params = new URLSearchParams(search);
  const highlight = params.get('c');
  const profileAccount = params.get('from') === 'profile' ? params.get('account') : null;
  const { state, character } = useSocial();
  const back = useBack();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const post = state.posts.find((p) => p.id === id);
  const author = post ? character(post.authorId) : undefined;
  const profilePosts = profileAccount ? state.posts.filter(p => p.authorId === profileAccount || p.collaboratorIds?.includes(profileAccount)).sort(byDateDesc) : [];
  const selectedIndex = profilePosts.findIndex(p => p.id === id);
  const visiblePosts = profileAccount && selectedIndex >= 0 ? profilePosts.slice(selectedIndex) : post ? [post] : [];

  if (!post || !author)
    return (
      <div>
        <TopBar title="Publicación" onBack={back} />
        <EmptyState
          title="Esta publicación ya no está"
          body="Puede que se haya eliminado o que todavía no se haya sincronizado. Volvé a intentarlo cuando tengas conexión."
          action={<Link href="/" className="inline-flex h-11 items-center rounded-full bg-secondary px-6 text-sm font-semibold" data-testid="link-post-missing-home">Volver al inicio</Link>}
        />
      </div>
    );

  return (
    <div>
      <TopBar title="Publicación" sub={author.name} onBack={back} />
      {visiblePosts.map((item, index) => (
        <div key={item.id} className={index === 0 ? 'pt-4' : 'border-t border-border/60 pt-4'}>
          <PostCard post={item} eager={index === 0} onCommentClick={() => document.getElementById(`post-comments-${item.id}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
          <section id={`post-comments-${item.id}`} ref={index === 0 ? commentsRef : undefined} className="scroll-mt-16 border-t border-border/60 px-4 pb-6 pt-4" aria-label="Comentarios">
            <h2 className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Comentarios</h2>
            <CommentList postId={item.id} onReply={setReplyTo} highlightId={index === 0 ? highlight : null} />
            <div className="mt-4">
              <CommentComposer postId={item.id} replyTo={index === 0 ? replyTo : null} onClearReply={() => setReplyTo(null)} />
            </div>
          </section>
        </div>
      ))}
    </div>
  );
}
