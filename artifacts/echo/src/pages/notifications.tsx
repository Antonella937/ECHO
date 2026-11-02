import { VerifiedBadge } from '@/components/echo/verified-badge';
import { useMemo } from 'react';
import { useLocation } from 'wouter';
import { useSocial } from '@/store/social-store';
import { TopBar } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { EmptyState } from '@/components/echo/skeletons';
import { resolveMedia, timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';
import type { Notification } from '@/domain/types';

const VERB: Record<Notification['kind'], string> = {
  like: 'le ha gustado tu foto',
  comment: 'ha comentado',
  reply: 'te ha respondido',
  comment_like: 'le ha gustado tu comentario',
  mention: 'te ha mencionado',
  message: 'te ha escrito',
  story_reply: 'ha respondido a tu historia',
  follow: 'ahora te sigue',
};

export default function NotificationsPage() {
  const { state, me, character, actions } = useSocial();
  const [, navigate] = useLocation();
  const list = useMemo(
    () => state.notifications.filter((n) => n.recipientId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt)),
    [state.notifications, me.id],
  );
  const unread = list.filter((n) => !n.read);
  const read = list.filter((n) => n.read);

  const open = (n: Notification) => {
    actions.markNotificationRead(n.id);
    if (n.kind === 'message' || n.kind === 'story_reply') navigate(`/messages/${n.actorId}`);
    else if (n.postId) navigate(`/p/${n.postId}${n.commentId ? `?c=${n.commentId}` : ''}`);
    else navigate(`/profile/${n.actorId}`);
  };

  const Row = ({ n }: { n: Notification }) => {
    const actor = character(n.actorId);
    const post = n.postId ? state.posts.find((p) => p.id === n.postId) : undefined;
    if (!actor) return null;
    return (
      <li>
        <button onClick={() => open(n)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-secondary/60" data-testid={`button-notification-${n.id}`}>
          <span className="relative">
            <CharacterAvatar character={actor} size={44} />
          </span>
          <span className="min-w-0 flex-1 text-[14px] leading-snug">
            <span className="font-semibold">{actor.handle}</span><VerifiedBadge account={actor} className="ml-0.5 h-3.5 w-3.5 align-[-2px]" /> <span className="text-foreground/85">{VERB[n.kind]}</span>
            {n.excerpt && <span className="text-muted-foreground">: {n.excerpt}</span>}
            <span className="ml-1.5 text-xs text-muted-foreground/80">{timeAgo(n.createdAt)}</span>
          </span>
          {post && <img src={resolveMedia(post.image)} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />}
          <span className={cn('h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} aria-label={n.read ? undefined : 'Sin leer'} />
        </button>
      </li>
    );
  };

  return (
    <div>
      <TopBar
        title="Avisos"
        right={
          unread.length > 0 && (
            <button onClick={actions.markAllNotificationsRead} className="h-10 rounded-full px-3 text-xs font-semibold text-primary" data-testid="button-mark-all-read">
              Marcar todo como leído
            </button>
          )
        }
      />
      {list.length === 0 ? (
        <EmptyState title="Todo en calma" body="Cuando alguien comente, responda o te escriba, aparecerá aquí." />
      ) : (
        <div className="px-1 pt-3">
          {unread.length > 0 && (
            <>
              <h2 className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Nuevas</h2>
              <ul>{unread.map((n) => <Row key={n.id} n={n} />)}</ul>
            </>
          )}
          {read.length > 0 && (
            <>
              <h2 className="px-4 pb-1 pt-5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Anteriores</h2>
              <ul className="opacity-80">{read.map((n) => <Row key={n.id} n={n} />)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}
