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

function CommentNode({ comment, replies, onReply, highlightId }: { comment: Comment; replies: Map<string, Comment[]>; onReply(c: Comment): void; highlightId?: string | null; depth: number }) {
  // Keep the conversation's reply relationships, but render every descendant at
  // the same visual indentation. Recursive nested <ul>s caused horizontal drift.
  const threadReplies: Comment[] = [];
  const visit = (parentId: string) => {
    for (const reply of replies.get(parentId) ?? []) {
      threadReplies.push(reply);
      visit(reply.id);
    }
  };
  visit(comment.id);

  return (
    <li data-testid={`thread-comment-${comment.id}`} className="min-w-0">
      <CommentRow comment={comment} onReply={onReply} highlight={highlightId === comment.id} />
      {threadReplies.length > 0 && (
        <ul className="mt-4 ml-8 min-w-0 flex flex-col gap-4 border-l border-border/70 pl-3">
          {threadReplies.map((reply) => (
            <li key={reply.id} className="min-w-0" data-testid={`thread-comment-${reply.id}`}>
              <CommentRow comment={reply} onReply={onReply} small highlight={highlightId === reply.id} />
            </li>
          ))}
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
  if (!author && !comment.guestHandle) return null;
  const liked = comment.likes.includes(me.id);
  return (
    <div className={cn('flex gap-3 rounded-2xl transition-colors', highlight && 'bg-accent/50 -mx-2 p-2')} data-testid={`comment-${comment.id}`}>
      {comment.guestHandle ? <div className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-secondary text-xs">♡</div> : author && <Link href={`/profile/${author.id}`} className="shrink-0" data-testid={`link-comment-author-${comment.id}`}><CharacterAvatar character={author} size={small ? 28 : 34} /></Link>}
      <div className="min-w-0 flex-1">
        <p className="text-[14px] leading-snug">
          {comment.guestHandle ? <span className="mr-1.5 font-semibold">@{comment.guestHandle}</span> : author && <Link href={`/profile/${author.id}`} className="mr-1.5 font-semibold">{author.handle}<VerifiedBadge account={author} className="ml-0.5 h-3.5 w-3.5 align-[-2px]" /></Link>}
          {replyTo && <span className="mr-1 text-primary">@{replyTo.handle}</span>}
          <span className="text-foreground/90"><SocialText text={comment.text} /></span>
        </p>
        <div className="mt-1.5 flex items-center gap-4 text-xs text-muted-foreground">
          <span>{timeAgo(comment.createdAt)}</span>
          {comment.likes.length > 0 && <span>{comment.likes.length} {t("Me gusta")}</span>}
          {!comment.guestHandle && <button onClick={() => onReply(comment)} className="-my-3 h-11 font-semibold hover:text-foreground" data-testid={`button-reply-${comment.id}`}>
            Responder
          </button>}
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
  const [communityOpen, setCommunityOpen] = useState(false);
  const [guestHandle, setGuestHandle] = useState('');
  const [guestText, setGuestText] = useState('');
  const [communityFrequency, setCommunityFrequency] = useState('normal');
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
      {post?.authorId === me.id && <div className="mb-3 rounded-xl border border-border p-3 text-sm">
        <label className="flex items-center justify-between gap-3"><span>Comentarios de comunidad ficticia</span><input type="checkbox" checked={!!me.communityCommentsEnabled} onChange={e => actions.setCommunityCommentsEnabled(me.id, e.target.checked)} /></label>
        {me.communityCommentsEnabled && <div className="mt-3 space-y-2">
          <label className="block text-xs text-muted-foreground" htmlFor="community-frequency">Cantidad por tanda</label>
          <select id="community-frequency" className="w-full rounded-lg border border-input bg-background p-2" value={communityFrequency} onChange={e => setCommunityFrequency(e.target.value)}>
            <option value="occasional">Ocasional · 1–2</option>
            <option value="normal">Normal · 3–4</option>
            <option value="high">Alta · 5–6</option>
          </select>
          <button type="button" className="w-full rounded-lg border border-border px-3 py-2 text-muted-foreground" disabled title="Pendiente de conectar al generador de IA">Generar comentarios con IA · próximamente</button>
          <p className="text-xs text-muted-foreground">Sin generación automática: cada tanda requerirá tocar el botón y nunca superará seis comentarios.</p>
          <button type="button" className="text-primary" onClick={() => setCommunityOpen(!communityOpen)}>{communityOpen ? 'Cerrar' : '+ Agregar comentario manual'}</button>
          {communityOpen && <form className="space-y-2" onSubmit={e => { e.preventDefault(); try { actions.addCommunityComment(postId, guestHandle, guestText); setGuestText(''); setError(null); } catch (err) { setError((err as Error).message); } }}>
            <input className="w-full rounded-lg border border-input bg-background p-2" value={guestHandle} onChange={e => setGuestHandle(e.target.value)} placeholder="@deadstatic.fans" maxLength={33} aria-label="Usuario ficticio" />
            <textarea className="w-full rounded-lg border border-input bg-background p-2" value={guestText} onChange={e => setGuestText(e.target.value)} placeholder="Comentario de fan" maxLength={500} aria-label="Comentario ficticio" />
            <button className="rounded-lg bg-primary px-3 py-2 text-primary-foreground" type="submit">Agregar comentario</button>
          </form>}
        </div>}
      </div>}
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
