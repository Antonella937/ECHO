import { useCreatorHubDmStatus, useCreatorHubDmCopy, markCreatorHubDmRead } from '@/lib/creator-hub-notifications';
import { useOfficialAnnouncementText } from '@/lib/official-announcement-translations';
import { useNotificationsText, useLocalizedNotificationExcerpt } from '@/lib/notifications-translations';
import { VerifiedBadge } from '@/components/echo/verified-badge';
import { useEffect, useMemo, useState } from 'react';
import { useUser } from '@clerk/react';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';
import { useLocation } from 'wouter';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { EmptyState } from '@/components/echo/skeletons';
import { useMediaResolver, timeAgo } from '@/lib/media';
import { postMedia } from '@/domain/post-media';
import { cn } from '@/lib/utils';
import type { Notification } from '@/domain/types';
import { groupNotifications } from '@/domain/social-features';
import { useStoryViewer } from '@/components/echo/story-viewer';

type Group = ReturnType<typeof groupNotifications>[number];

const VERB: Record<Notification['kind'], string> = {
  like: 'le ha gustado tu foto',
  comment: 'ha comentado',
  reply: 'te ha respondido',
  comment_like: 'le ha gustado tu comentario',
  mention: 'te ha mencionado',
  message: 'te ha escrito',
  story_reply: 'ha respondido a tu historia',
  story_like: 'le ha gustado tu historia',
  follow: 'ahora te sigue',
};

export default function NotificationsPage() {
  const t = useNotificationsText();
  const back = useBack();
  const officialText = useOfficialAnnouncementText();
  const language = useLanguage();
  const { user } = useUser();
  const creatorDm = useCreatorHubDmStatus();
  const creatorDmCopy = useCreatorHubDmCopy();
  const [creatorPosts, setCreatorPosts] = useState<Array<{ id: string; ownerId: string; displayName: string; title: string; body: string; createdAt: string }>>([]);
  const [creatorRead, setCreatorRead] = useState<string[]>([]);
  const [serverRead, setServerRead] = useState<string[]>([]);
  const [officialSubscribed, setOfficialSubscribed] = useState(true);
  const [showSubscriptionIntro, setShowSubscriptionIntro] = useState(false);
  const [officialUpdates, setOfficialUpdates] = useState<Array<{ id: string; title: string; body: string; createdAt: string }>>([]);
  const [officialRead, setOfficialRead] = useState<string[]>([]);
  useEffect(() => {
    if (!user?.id) return;
    let active = true;
    const key = 'echo-official-read:' + user.id;
    const introKey = 'echo-official-subscription-intro:' + user.id;
    setShowSubscriptionIntro(localStorage.getItem(introKey) !== '1');
    if (localStorage.getItem(introKey) !== '1') localStorage.setItem(introKey, '1');
    void customFetch<{ subscribed: boolean }>('/api/creator-hub/social/announcement-subscription', { responseType: 'json' })
      .then(data => { if (active) setOfficialSubscribed(data.subscribed); }).catch(() => {});
    void customFetch<{ ids: string[] }>('/api/creator-hub/social/notification-reads', { responseType: 'json' })
      .then(data => { if (active) setServerRead(data.ids); }).catch(() => {});
    try { setCreatorRead(JSON.parse(localStorage.getItem('echo-creator-read:' + user.id) || '[]')); } catch { setCreatorRead([]); }
    void customFetch<{ publications: typeof creatorPosts }>('/api/creator-hub/social/following-publications', { responseType: 'json' })
      .then(data => { if (active) setCreatorPosts(data.publications); }).catch(() => {});
    try { setOfficialRead(JSON.parse(localStorage.getItem(key) || '[]')); } catch { setOfficialRead([]); }
    void customFetch<{ updates: typeof officialUpdates }>('/api/creator-hub/social/official-updates', { responseType: 'json' })
      .then(data => { if (active) setOfficialUpdates(data.updates); }).catch(() => {});
    return () => { active = false; };
  }, [user?.id]);
  const saveServerRead = (id: string) => {
    if (serverRead.includes(id)) return;
    setServerRead(previous => [...new Set([...previous, id])]);
    void customFetch('/api/creator-hub/social/notification-reads', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ ids: [id] }) }).catch(() => {});
  };
  const markOfficialRead = (id: string) => {
    saveServerRead(id);
    if (!user?.id) return;
    const next = [...new Set([...officialRead, id])];
    setOfficialRead(next);
    localStorage.setItem('echo-official-read:' + user.id, JSON.stringify(next));
  };
  const resolveMedia = useMediaResolver();
  const { state, me, character, actions } = useSocial();
  const { openStoryList } = useStoryViewer();
  const [, navigate] = useLocation();
  const list = useMemo(
    () => groupNotifications(state.notifications.filter((n) => n.recipientId === me.id)),
    [state.notifications, me.id],
  );
  const unread = list.filter((n) => !n.read);
  const read = list.filter((n) => n.read);

  const open = (n: Group) => {
    n.ids.forEach((id) => { if (state.notifications.find((x) => x.id === id && !x.read)) actions.markNotificationRead(id); });
    if (n.kind === 'message' || n.kind === 'story_reply') navigate(`/messages/${n.actorId}`);
    else if (n.postId) navigate(`/p/${n.postId}${n.commentId ? `?c=${n.commentId}` : ''}`);
    else if (n.storyId && state.stories.some(s => s.id === n.storyId))
      openStoryList(state.stories.find(s => s.id === n.storyId)!.authorId, [n.storyId]);
    else navigate(`/profile/${n.actorId}`);
  };



  return (
    <div>
      <TopBar
        title={t("Avisos")}
        onBack={back}
        right={
          <button disabled={unread.length === 0} onClick={actions.markAllNotificationsRead} className="h-10 rounded-full px-3 text-xs font-semibold text-primary disabled:cursor-default disabled:opacity-45" data-testid="button-mark-all-read">
              {t("Marcar todo como leído")}
          </button>
        }
      />
      {showSubscriptionIntro && <div className="mx-4 mt-3 flex items-center justify-between gap-3 rounded-xl border border-border bg-card p-3">
        <div><p className="text-sm font-semibold">📣 ECHO · {officialText.title}</p><p className="text-xs text-muted-foreground">{officialText.detail}</p></div>
        <button type="button" aria-pressed={officialSubscribed} onClick={() => {
          const next = !officialSubscribed;
          setOfficialSubscribed(next);
          void customFetch('/api/creator-hub/social/announcement-subscription', { method: 'PUT', responseType: 'json', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ subscribed: next }) }).catch(() => setOfficialSubscribed(!next));
          if (!next) setOfficialUpdates([]);
        }} className="shrink-0 rounded-full border border-border px-3 py-2 text-xs font-semibold">{officialSubscribed ? officialText.subscribed : officialText.muted}</button>
      </div>}
      {creatorDm.enabled && creatorDm.items.some(item => item.unread) && <section className="px-4 pt-4" aria-label={creatorDmCopy.title}>
        <h2 className="mb-2 text-sm font-semibold">💬 {creatorDmCopy.title}</h2>
        <div className="space-y-2">{creatorDm.items.filter(item => item.unread).map(item =>
          <button key={item.ownerId} type="button" className="flex w-full items-center gap-3 rounded-xl border border-border bg-card p-3 text-left"
            onClick={() => {
              if (user?.id) void markCreatorHubDmRead(user.id, item.ownerId).catch(() => {});
              sessionStorage.setItem('echo:open-creator-chat', item.ownerId);
              navigate('/creator-hub');
            }}>
            <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />
            <span className="min-w-0 flex-1"><span className="block text-sm font-semibold">{item.displayName}</span>
              <span className="block truncate text-xs text-muted-foreground">{item.kind === 'voice' ? creatorDmCopy.voice : item.preview || creatorDmCopy.message}</span></span>
            <span className="text-xs text-muted-foreground">{timeAgo(item.createdAt)}</span>
          </button>)}</div>
      </section>}
      {officialSubscribed && officialUpdates.length > 0 && <section className="px-4 pt-4" aria-label={officialText.title}>
        <h2 className="mb-2 text-sm font-semibold text-foreground">📣 {officialText.title}</h2>
        <div className="space-y-2">{officialUpdates.slice(0, 10).map(item => <details key={item.id} onToggle={e => { if (e.currentTarget.open) markOfficialRead(item.id); }} className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold text-foreground">{!officialRead.includes(item.id) && !serverRead.includes(item.id) && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary" aria-label="Unread"/>}{item.title}<span className="ml-2 text-xs font-normal text-muted-foreground">{new Date(item.createdAt).toLocaleDateString(language)}</span></summary>
          <p className="mt-3 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
        </details>)}</div>
      </section>}
      {creatorPosts.length > 0 && <section className="px-4 pt-4" aria-label={language === 'en' ? 'Followed creators' : 'Creadores que seguís'}>
        <h2 className="mb-2 text-sm font-semibold">👥 {officialText.following}</h2>
        <div className="space-y-2">{creatorPosts.slice(0, 15).map(item => <details key={item.id} onToggle={e => { if (!e.currentTarget.open || !user?.id) return; saveServerRead(item.id); const next = [...new Set([...creatorRead, item.id])]; setCreatorRead(next); localStorage.setItem('echo-creator-read:' + user.id, JSON.stringify(next)); }} className="rounded-xl border border-border bg-card p-3">
          <summary className="cursor-pointer text-sm font-semibold">{!creatorRead.includes(item.id) && !serverRead.includes(item.id) && <span className="mr-2 inline-block h-2 w-2 rounded-full bg-primary"/>}<span className="text-muted-foreground">@{item.displayName} · </span>{item.title}</summary>
          <p className="mt-2 whitespace-pre-wrap text-sm text-muted-foreground">{item.body}</p>
        </details>)}</div>
      </section>}
      {list.length === 0 && officialUpdates.length === 0 && creatorPosts.length === 0 && !(creatorDm.enabled && creatorDm.items.some(item => item.unread)) ? (
        <EmptyState title={t("Todo en calma")} body={t("Cuando alguien comente, responda o te escriba, aparecerá aquí.")} />
      ) : (
        <div className="px-1 pt-3">
          {unread.length > 0 && (
            <>
              <h2 className="px-4 pb-1 pt-2 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("Nuevas")}</h2>
              <ul>{unread.map((n) => <NotificationRow key={n.id} n={n} character={character} state={state} open={open} resolveMedia={resolveMedia} />)}</ul>
            </>
          )}
          {read.length > 0 && (
            <>
              <h2 className="px-4 pb-1 pt-5 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("Anteriores")}</h2>
              <ul className="opacity-80">{read.map((n) => <NotificationRow key={n.id} n={n} character={character} state={state} open={open} resolveMedia={resolveMedia} />)}</ul>
            </>
          )}
        </div>
      )}
    </div>
  );
}

function NotificationRow({ n, character, state, open, resolveMedia }: {
  n: Group;
  character: ReturnType<typeof useSocial>['character'];
  state: ReturnType<typeof useSocial>['state'];
  open: (n: Group) => void;
  resolveMedia: ReturnType<typeof useMediaResolver>;
}) {
    const t = useNotificationsText();
    const localizeExcerpt = useLocalizedNotificationExcerpt();
    const actor = character(n.actorId);
    const others = n.actorIds.filter((a) => a !== n.actorId).map(character).filter(Boolean);
    const post = n.postId ? state.posts.find((p) => p.id === n.postId) : undefined;
    if (!actor) return null;
    return (
      <li>
        <button onClick={() => open(n)} className="flex w-full items-center gap-3 rounded-2xl px-3 py-2.5 text-left hover:bg-secondary/60" data-testid={`button-notification-${n.id}`}>
          <span className="relative">
            <CharacterAvatar character={actor} size={44} />
            {others[0] && <CharacterAvatar character={others[0]} size={24} className="absolute -bottom-1 -right-1 rounded-full ring-2 ring-background" />}
          </span>
          <span className="min-w-0 flex-1 text-[14px] leading-snug">
            <span className="font-semibold">{actor.handle}</span><VerifiedBadge account={actor} className="ml-0.5 h-3.5 w-3.5 align-[-2px]" />
            {others.length > 0 && <span className="text-foreground/85" data-testid={`text-notification-group-${n.id}`}>{others.length === 1 ? `${t(" y ")}${others[0]!.handle}` : `${t(" y ")}${others.length}${t(" más")}`}</span>}
            {others.length === 0 && n.count > 1 && <span className="text-muted-foreground"> ({n.count})</span>} <span className="text-foreground/85">{t(VERB[n.kind])}</span>
            {n.excerpt && <span className="text-muted-foreground">: {localizeExcerpt(n.excerpt)}</span>}
            <span className="ml-1.5 text-xs text-muted-foreground/80">{timeAgo(n.createdAt)}</span>
          </span>
          {post && postMedia(post).length > 0 && post.media?.[0]?.type !== 'video' && <img src={resolveMedia(post.image, { sourceType: 'post', sourceContentId: post.id })} alt="" className="h-11 w-11 shrink-0 rounded-lg object-cover" />}
          <span className={cn('h-2 w-2 shrink-0 rounded-full', n.read ? 'bg-transparent' : 'bg-primary')} aria-label={n.read ? undefined : t('Sin leer')} />
        </button>
      </li>
    );
}
