import { usePostInteractionsText } from '@/lib/post-interactions-translations';
import { VerifiedBadge } from './verified-badge';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Heart, X } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';
import { SocialText } from './social-text';
import type { Comment } from '@/domain/types';

export function CommentList({ postId, onReply, highlightId }: { postId: string; onReply(c: Comment): void; highlightId?: string | null }) {
  const t = usePostInteractionsText();
  const { state } = useSocial();
  const post = state.posts.find((p) => p.id === postId);
  const visualCount = Math.max(0, Math.floor(Number(post?.displayMetrics?.comments) || 0));
  const { roots, replies } = useMemo(() => {
    const all = state.comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const ids = new Set(all.map((c) => c.id));
    const map = new Map<string, Comment[]>();
    all.filter((c) => c.parentId && ids.has(c.parentId)).forEach((c) => map.set(c.parentId!, [...(map.get(c.parentId!) ?? []), c]));
    return { roots: all.filter((c) => !c.parentId || !ids.has(c.parentId)), replies: map };
  }, [state.comments, postId]);

  if (!roots.length)
    return (
      <div className="py-12 text-center" data-testid="empty-comments">
        {visualCount > 0 ? (
          <>
            <p className="font-display text-lg font-light">{visualCount.toLocaleString()} {t("Comentarios contabilizados sin mensajes visibles")}</p>
          </>
        ) : (
          <>
            <p className="font-display text-lg font-light">{t("Todavía no hay comentarios")}</p>
            <p className="mt-1 text-sm text-muted-foreground">{t("Di algo bonito. O algo cierto.")}</p>
          </>
        )}
      </div>
    );

  return (
    <ul className="flex flex-col gap-5 py-2">
      {roots.map((c) => (
        <CommentNode key={c.id} comment={c} replies={replies} onReply={onReply} highlightId={highlightId} depth={0} />
      ))}
    </ul>
  );
}

function CommentNode({ comment, replies, onReply, highlightId, depth }: { comment: Comment; replies: Map<string, Comment[]>; onReply(c: Comment): void; highlightId?: string | null; depth: number }) {
  const children = replies.get(comment.id) ?? [];
  return (
    <li data-testid={`thread-comment-${comment.id}`}>
      <CommentRow comment={comment} onReply={onReply} small={depth > 0} highlight={highlightId === comment.id} />
      {children.length > 0 && (
        <ul className={cn('mt-4 flex flex-col gap-4 border-l border-border/70', depth < 3 ? 'ml-10 pl-3' : 'ml-2 pl-2')}>
          {children.map((r) => <CommentNode key={r.id} comment={r} replies={replies} onReply={onReply} highlightId={highlightId} depth={depth + 1} />)}
        </ul>
      )}
    </li>
  );
}

function CommentRow({ comment, onReply, small, highlight }: { comment: Comment; onReply(c: Comment): void; small?: boolean; highlight?: boolean }) {
  const t = usePostInteractionsText();
  const { character, me, actions } = useSocial();
  const author = character(comment.authorId);
  const replyTo = comment.replyToAuthorId ? character(comment.replyToAuthorId) : undefined;
  if (!author) return null;
  const liked = comment.likes.includes(me.id);
  return (
    <div className={cn('flex gap-3 rounded-2xl transition-colors', highlight && 'bg-accent/50 -mx-2 p-2')} data-testid={`comment-${comment.id}`}>
      <Link href={`/profile/${author.id}`} className="shrink-0" data-testid={`link-comment-author-${comment.id}`}>
        <CharacterAvatar character={author} size={small ? 28 : 34} />
      </Link>
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug">
          <Link href={`/profile/${author.id}`} className="mr-1.5 font-semibold">{author.handle}<VerifiedBadge account={author} className="ml-0.5 h-3.5 w-3.5 align-[-2px]" /></Link>
          {replyTo && <span className="mr-1 text-primary">@{replyTo.handle}</span>}
          <span className="text-foreground/90"><SocialText text={comment.text} /></span>
        </p>
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
          <span>{timeAgo(comment.createdAt)}</span>
          {comment.likes.length > 0 && <span>{comment.likes.length} {t("Me gusta")}</span>}
          <button onClick={() => onReply(comment)} className="-my-3 h-11 font-semibold hover:text-foreground" data-testid={`button-reply-${comment.id}`}>
            Responder
          </button>
        </div>
      </div>
      <button
        onClick={() => actions.toggleCommentLike(comment.id)}
        className="tap -mr-2 grid h-11 w-11 shrink-0 place-items-center"
        aria-label={t(liked ? 'Quitar me gusta' : 'Me gusta')}
        aria-pressed={liked}
        data-testid={`button-like-comment-${comment.id}`}
      >
        <Heart className={cn('h-3.5 w-3.5', liked ? 'fill-primary text-primary' : 'text-muted-foreground')} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function CommentComposer({ postId, replyTo, onClearReply, autoFocus }: { postId: string; replyTo: Comment | null; onClearReply(): void; autoFocus?: boolean }) {
  const t = usePostInteractionsText();
  const { me, character, actions, state } = useSocial();
  const [text, setText] = useState('');
  const [error, setError] = useState<string | null>(null);
  const post = state.posts.find((p) => p.id === postId);
  const ref = useRef<HTMLInputElement>(null);
  const target = replyTo ? character(replyTo.authorId) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    try {
      if (replyTo) actions.addComment(postId, text, replyTo.id, replyTo.authorId);
      else actions.addComment(postId, text);
    } catch (err) {
      setError((err as Error).message);
      return;
    }
    setError(null);
    setText('');
    onClearReply();
  };

  if (post?.commentsEnabled === false)
    return (
      <p className="rounded-2xl bg-secondary px-4 py-3 text-center text-sm text-muted-foreground" data-testid="status-comments-disabled">
        Los comentarios están desactivados. El historial se conserva.
      </p>
    );

  return (
    <div>
      {error && <p role="alert" className="mb-2 text-xs text-destructive" data-testid="text-comment-error">{error}</p>}
      {replyTo && target && (
        <div className="mb-2 flex items-center justify-between rounded-full bg-secondary px-4 py-1.5 text-xs text-muted-foreground">
          <span>{t("Respondiendo a")} <span className="text-foreground">@{target.handle}</span></span>
          <button onClick={onClearReply} aria-label={t("Cancelar respuesta")} className="-my-3 grid h-11 w-11 place-items-center" data-testid="button-cancel-reply">
            <X className="h-3.5 w-3.5" />
          </button>
        </div>
      )}
      <form onSubmit={submit} className="flex items-center gap-3 pb-1">
        <CharacterAvatar character={me} size={34} />
        <input
          ref={ref}
          key={replyTo?.id ?? 'root'}
          autoFocus={autoFocus || !!replyTo}
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder={replyTo ? t('Escribe tu respuesta…') : `${t('Comentar como')} ${me.name.split(' ')[0]}…`}
          className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-[15px] placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
          aria-label={t("Comentario")}
          data-testid="input-comment"
        />
        <button
          type="submit"
          disabled={!text.trim()}
          className="h-11 px-1 text-sm font-semibold text-primary disabled:opacity-40"
          data-testid="button-comment-submit"
        >
          Publicar
        </button>
      </form>
    </div>
  );
}
