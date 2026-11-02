import { useRef, useState } from 'react';
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
  const highlight = new URLSearchParams(search).get('c');
  const { state, character } = useSocial();
  const back = useBack();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  const commentsRef = useRef<HTMLDivElement>(null);
  const post = state.posts.find((p) => p.id === id);
  const author = post ? character(post.authorId) : undefined;

  if (!post || !author)
    return (
      <div>
        <TopBar title="Publicación" onBack={back} />
        <EmptyState
          title="Esta foto ya no está"
          body="Puede que se haya eliminado, o que el enlace venga de otro dispositivo. ECHO todavía guarda todo solo aquí."
          action={<Link href="/" className="inline-flex h-11 items-center rounded-full bg-secondary px-6 text-sm font-semibold" data-testid="link-post-missing-home">Volver al inicio</Link>}
        />
      </div>
    );

  return (
    <div>
      <TopBar title="Publicación" sub={author.name} onBack={back} />
      <div className="pt-4">
        <PostCard post={post} eager onCommentClick={() => commentsRef.current?.scrollIntoView({ behavior: 'smooth', block: 'start' })} />
      </div>
      <section ref={commentsRef} className="scroll-mt-16 border-t border-border/60 px-4 pb-6 pt-4" aria-label="Comentarios">
        <h2 className="mb-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Comentarios</h2>
        <CommentList postId={post.id} onReply={setReplyTo} highlightId={highlight} />
        <div className="mt-4">
          <CommentComposer postId={post.id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />
        </div>
      </section>
    </div>
  );
}
