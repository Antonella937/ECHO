import { VerifiedBadge } from './verified-badge';
import { useMemo, useRef, useState, type FormEvent } from 'react';
import { Link } from 'wouter';
import { Heart, X } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';
import type { Comment } from '@/domain/types';

export function CommentList({ postId, onReply, highlightId }: { postId: string; onReply(c: Comment): void; highlightId?: string | null }) {
  const { state } = useSocial();
  const { roots, replies } = useMemo(() => {
    const all = state.comments.filter((c) => c.postId === postId).sort((a, b) => a.createdAt.localeCompare(b.createdAt));
    const map = new Map<string, Comment[]>();
    all.filter((c) => c.parentId).forEach((c) => map.set(c.parentId!, [...(map.get(c.parentId!) ?? []), c]));
    return { roots: all.filter((c) => !c.parentId), replies: map };
  }, [state.comments, postId]);

  if (!roots.length)
    return (
      <div className="py-12 text-center" data-testid="empty-comments">
        <p className="font-display text-lg font-light">Todavía no hay comentarios</p>
        <p className="mt-1 text-sm text-muted-foreground">Di algo bonito. O algo cierto.</p>
      </div>
    );

  return (
    <ul className="flex flex-col gap-5 py-2">
      {roots.map((c) => (
        <li key={c.id}>
          <CommentRow comment={c} onReply={onReply} highlight={highlightId === c.id} />
          {(replies.get(c.id) ?? []).length > 0 && (
            <ul className="ml-12 mt-4 flex flex-col gap-4 border-l border-border/70 pl-4">
              {replies.get(c.id)!.map((r) => (
                <li key={r.id}>
                  <CommentRow comment={r} onReply={onReply} small highlight={highlightId === r.id} />
                </li>
              ))}
            </ul>
          )}
        </li>
      ))}
    </ul>
  );
}

function CommentRow({ comment, onReply, small, highlight }: { comment: Comment; onReply(c: Comment): void; small?: boolean; highlight?: boolean }) {
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
          <span className="text-foreground/90">{comment.text}</span>
        </p>
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
          <span>{timeAgo(comment.createdAt)}</span>
          {comment.likes.length > 0 && <span>{comment.likes.length} me gusta</span>}
          <button onClick={() => onReply(comment)} className="font-semibold hover:text-foreground" data-testid={`button-reply-${comment.id}`}>
            Responder
          </button>
        </div>
      </div>
      <button
        onClick={() => actions.toggleCommentLike(comment.id)}
        className="tap -mr-2 grid h-9 w-9 shrink-0 place-items-center"
        aria-label={liked ? 'Quitar me gusta' : 'Me gusta'}
        aria-pressed={liked}
        data-testid={`button-like-comment-${comment.id}`}
      >
        <Heart className={cn('h-3.5 w-3.5', liked ? 'fill-primary text-primary' : 'text-muted-foreground')} strokeWidth={1.8} />
      </button>
    </div>
  );
}

export function CommentComposer({ postId, replyTo, onClearReply, autoFocus }: { postId: string; replyTo: Comment | null; onClearReply(): void; autoFocus?: boolean }) {
  const { me, character, actions } = useSocial();
  const [text, setText] = useState('');
  const ref = useRef<HTMLInputElement>(null);
  const target = replyTo ? character(replyTo.authorId) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    if (replyTo) actions.addComment(postId, text, replyTo.parentId ?? replyTo.id, replyTo.authorId);
    else actions.addComment(postId, text);
    setText('');
    onClearReply();
  };

  return (
    <div>
      {replyTo && target && (
        <div className="mb-2 flex items-center justify-between rounded-full bg-secondary px-4 py-1.5 text-xs text-muted-foreground">
          <span>Respondiendo a <span className="text-foreground">@{target.handle}</span></span>
          <button onClick={onClearReply} aria-label="Cancelar respuesta" className="grid h-7 w-7 place-items-center" data-testid="button-cancel-reply">
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
          placeholder={replyTo ? 'Escribe tu respuesta…' : `Comentar como ${me.name.split(' ')[0]}…`}
          className="h-11 min-w-0 flex-1 rounded-full border border-input bg-background px-4 text-[15px] placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
          aria-label="Comentario"
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
