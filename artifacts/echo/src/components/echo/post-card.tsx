import { MusicClipPlayer } from './music-clip-player';
import { useFeedText } from '@/lib/feed-translations';
import { useRef, useState, type ReactNode } from 'react';
import { Link } from 'wouter';
import { Bookmark, Heart, MessageCircle, MoreHorizontal, Pin, Send, UserRound } from 'lucide-react';
import { SocialText } from './social-text';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { VerifiedBadge } from './verified-badge';
import { PostMetricsEditor } from './post-metrics-editor';
import { shownCount, formatCount } from '@/domain/accounts';
import { CommentsSheet, LikersSheet, OptionsSheet, ShareSheet } from './post-sheets';
import { timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';
import { PostMediaView } from './post-media';
import { postMedia } from '@/domain/post-media';
import type { Post } from '@/domain/types';

interface Props {
  post: Post;
  /** When true, comments render inline elsewhere and the comment button focuses them instead of a sheet. */
  onCommentClick?: () => void;
  eager?: boolean;
}

export function PostCard({ post, onCommentClick, eager }: Props) {
  const t = useFeedText();
  const { me, character, actions, state } = useSocial();
  const author = character(post.authorId);
  const [sheet, setSheet] = useState<null | 'comments' | 'likers' | 'share' | 'options'>(null);
  const [burst, setBurst] = useState(0);
  const [showPhotoTags, setShowPhotoTags] = useState(false);
  const lastTap = useRef(0);
  if (!author) return null;

  const liked = post.likes.includes(me.id);
  const saved = post.savedBy.includes(me.id);
  const commentCount = state.comments.filter((c) => c.postId === post.id).length;
  const displayedCommentCount = shownCount(post.displayMetrics?.comments, commentCount);
  const likers = post.likes.map(character).filter(Boolean);
  const tagged = (post.taggedAccountIds ?? []).map(character).filter(Boolean);
  const collaborators = (post.collaboratorIds ?? []).map(character).filter(Boolean);
  const invitedMe = (post.collaborationInvites ?? []).includes(me.id);
  const media = postMedia(post);
  const firstLiker = likers.find((c) => c && c.id !== me.id) ?? likers[0];

  const onImageTap = () => {
    const now = Date.now();
    if (now - lastTap.current < 320) {
      if (!liked) actions.toggleLike(post.id);
      setBurst((b) => b + 1);
    }
    lastTap.current = now;
  };

  const openComments = () => (onCommentClick ? onCommentClick() : setSheet('comments'));

  return (
    <article className="fade-up pb-6" data-testid={`card-post-${post.id}`}>
      <header className="flex items-center gap-3 px-4 pb-3">
        <Link href={`/profile/${author.id}`} data-testid={`link-post-author-${post.id}`}>
          <CharacterAvatar character={author} size={38} />
        </Link>
        <div className="min-w-0 flex-1 leading-tight">
          <Link href={`/profile/${author.id}`} className="inline-flex items-center gap-1 text-[14.5px] font-semibold">{author.handle}<VerifiedBadge account={author} /></Link>
          {collaborators.length > 0 && <p className="text-xs text-muted-foreground">{t("Con")} {collaborators.map((c, i) => c && <span key={c.id}><Link href={`/profile/${c.id}`} className="font-semibold">@{c.handle}</Link>{i < collaborators.length - 1 ? ', ' : ''}</span>)}</p>}
          {post.location && <Link href={`/search?location=${encodeURIComponent(post.location)}`} className="block truncate text-xs text-muted-foreground" data-testid={`link-post-location-${post.id}`}>{post.location}</Link>}
        </div>
        {post.pinned && <Pin className="h-4 w-4 text-primary" strokeWidth={1.8} aria-label={t("Fijada")} data-testid={`status-post-pinned-${post.id}`} />}
        <button onClick={() => setSheet('options')} aria-label={t("Opciones")} className="tap -mr-2 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:text-foreground" data-testid={`button-options-${post.id}`}>
          <MoreHorizontal className="h-5 w-5" strokeWidth={1.6} />
        </button>
      </header>

      {media.length > 0 && (
        <div className="relative px-0 sm:px-3">
          <PostMediaView
            postId={post.id}
            media={media}
            alt={post.caption || `${t("Foto de")} ${author.name}`}
            eager={eager}
            onTap={onImageTap}
            overlay={burst > 0 && (
              <span key={burst} className="heart-pop pointer-events-none absolute inset-0 grid place-items-center">
                <Heart className="h-24 w-24 fill-primary text-primary drop-shadow-lg" strokeWidth={1} />
              </span>
            )}
          />
          {tagged.length > 0 && <button type="button" onClick={() => setShowPhotoTags(v => !v)} aria-label={t("Con")} aria-expanded={showPhotoTags} className="absolute bottom-3 left-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white shadow-md" data-testid={`button-photo-tags-${post.id}`}><UserRound className="h-4 w-4" /></button>}
          {showPhotoTags && tagged.length > 0 && <div className="absolute bottom-14 left-3 z-10 max-w-[85%] rounded-xl bg-black/80 p-2 text-white shadow-lg" data-testid={`overlay-photo-tags-${post.id}`}>
            <p className="mb-1 text-[11px] opacity-75">{t("Con")}</p>
            <div className="flex flex-wrap gap-1.5">{tagged.map(c => c && <Link key={c.id} href={`/profile/${c.id}`} className="rounded-lg bg-white/15 px-2.5 py-1.5 text-xs font-medium hover:bg-white/25">@{c.handle}</Link>)}</div>
          </div>}
        </div>
      )}

      {invitedMe && <div className="mx-4 my-3 rounded-xl border border-border bg-secondary/50 p-3 text-sm">
        <p className="mb-2 font-medium">{t("Invitación a colaborar en esta publicación")}</p>
        <div className="flex gap-2"><button type="button" onClick={() => actions.respondCollaboration(post.id, true)} className="rounded-lg bg-primary px-4 py-2 text-xs font-semibold text-primary-foreground">{t("Aceptar")}</button><button type="button" onClick={() => actions.respondCollaboration(post.id, false)} className="rounded-lg bg-secondary px-4 py-2 text-xs font-semibold">{t("Rechazar")}</button></div>
      </div>}
      {post.musicClip && <div className="px-3 pt-3"><MusicClipPlayer clip={post.musicClip} compact /></div>}
      <div className="flex items-center px-2.5 pt-2">
        <IconBtn label={t(liked ? 'Quitar me gusta' : 'Me gusta')} pressed={liked} onClick={() => actions.toggleLike(post.id)} testId={`button-like-${post.id}`}>
          <Heart className={cn('h-[25px] w-[25px] transition-transform', liked && 'scale-110 fill-primary text-primary')} strokeWidth={1.6} />
        </IconBtn>
        <IconBtn label={t("Comentar")} onClick={openComments} testId={`button-comment-${post.id}`}>
          <span className="relative inline-flex">
            <MessageCircle className="h-[24px] w-[24px] -scale-x-100" strokeWidth={1.6} />
            {displayedCommentCount > 0 && <span className="absolute -right-3 -top-2 min-w-4 rounded-full bg-primary px-1 text-center text-[10px] font-semibold leading-4 text-primary-foreground" data-testid={`badge-comments-${post.id}`}>{formatCount(displayedCommentCount)}</span>}
          </span>
        </IconBtn>
        <IconBtn label={t("Compartir")} onClick={() => setSheet('share')} testId={`button-share-${post.id}`}>
          <Send className="h-[23px] w-[23px]" strokeWidth={1.6} />
        </IconBtn>
        <span className="flex-1" />
        <IconBtn label={t(saved ? 'Quitar de guardados' : 'Guardar')} pressed={saved} onClick={() => actions.toggleSave(post.id)} testId={`button-save-${post.id}`}>
          <Bookmark className={cn('h-[24px] w-[24px]', saved && 'fill-foreground')} strokeWidth={1.6} />
        </IconBtn>
      </div>

      <div className="px-4">
        {post.likes.length > 0 ? (
          <button onClick={() => setSheet('likers')} className="text-left text-[14px]" data-testid={`button-likers-${post.id}`}>
            {t('Le gusta a')} <span className="font-semibold">{firstLiker?.id === me.id ? t('ti') : firstLiker?.handle}</span>
            {post.likes.length > 1 && (
              <>
                {' '}{t('y a')} <span className="font-semibold">{post.likes.length - 1 === 1 ? t('1 persona más') : `${post.likes.length - 1} ${t('personas más')}`}</span>
              </>
            )}
          </button>
        ) : shownCount(post.displayMetrics?.likes, post.likes.length) === 0 ? (
          <p className="text-[14px] text-muted-foreground">{t("Sé la primera persona en darle me gusta")}</p>
        ) : null}
        <div className="mt-1 flex items-center gap-3 text-[13px] text-muted-foreground">
          <span data-testid={`text-likes-count-${post.id}`}><span className="font-semibold text-foreground">{formatCount(shownCount(post.displayMetrics?.likes, post.likes.length))}</span> {t("me gusta")}</span>
          <span data-testid={`text-comments-count-${post.id}`}><span className="font-semibold text-foreground">{formatCount(displayedCommentCount)}</span> {t("comentarios")}</span>
          <span className="flex-1" />
          <PostMetricsEditor post={post} actualComments={commentCount} />
        </div>
        {post.caption && (
          <p className="mt-1.5 whitespace-pre-wrap break-words text-[14.5px] leading-relaxed text-foreground/90" data-testid={`text-caption-${post.id}`}>
            <Link href={`/profile/${author.id}`} className="mr-1.5 font-semibold text-foreground">{author.handle}</Link>
            <SocialText text={post.caption} />
          </p>
        )}
        {tagged.length > 0 && (
          <p className="mt-2 flex flex-wrap items-center gap-x-1.5 gap-y-1 text-[13px] leading-5 text-muted-foreground" data-testid={`text-tagged-${post.id}`}>
            <UserRound className="h-3.5 w-3.5 shrink-0" strokeWidth={1.8} /><span>{t("Con")}</span>
            {tagged.map((c, i) => c && (
              <Link key={c.id} href={`/profile/${c.id}`} className="font-semibold text-foreground" data-testid={`link-tagged-${post.id}-${c.id}`}>@{c.handle}{i < tagged.length - 1 ? ',' : ''}</Link>
            ))}
          </p>
        )}
        {displayedCommentCount > 0 && (
          <button onClick={openComments} className="mt-1.5 text-[14px] text-muted-foreground" data-testid={`button-view-comments-${post.id}`}>
            {displayedCommentCount === 1 ? t('Ver 1 comentario') : `${t('Ver los')} ${formatCount(displayedCommentCount)} ${t('comentarios (ver)')}`}
          </button>
        )}
        <Link href={`/p/${post.id}`} className="mt-1 block text-[11.5px] uppercase tracking-[0.08em] text-muted-foreground/80" data-testid={`link-post-time-${post.id}`}>
          {timeAgo(post.createdAt)}{post.editedAt ? t(' · editada') : ''}
        </Link>
        {post.commentsEnabled === false && <p className="mt-1 text-[12px] text-muted-foreground" data-testid={`status-comments-off-${post.id}`}>{t("Comentarios desactivados")}</p>}
      </div>

      <CommentsSheet post={post} open={sheet === 'comments'} onClose={() => setSheet(null)} />
      <LikersSheet post={post} open={sheet === 'likers'} onClose={() => setSheet(null)} />
      <ShareSheet post={post} open={sheet === 'share'} onClose={() => setSheet(null)} />
      <OptionsSheet post={post} open={sheet === 'options'} onClose={() => setSheet(null)} />
    </article>
  );
}

function IconBtn({ children, label, onClick, pressed, testId }: { children: ReactNode; label: string; onClick(): void; pressed?: boolean; testId: string }) {
  return (
    <button onClick={onClick} aria-label={label} aria-pressed={pressed} className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary/60" data-testid={testId}>
      {children}
    </button>
  );
}
