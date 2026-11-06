import { useDiscoveryText } from '@/lib/discovery-translations';
import { useMemo, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { Archive, Bookmark, Grid3x3, UserSquare2, MapPin, MessageCircle, Pencil, PlusSquare, Repeat2, Settings } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { PhotoGrid } from '@/components/echo/photo-grid';
import { EmptyState } from '@/components/echo/skeletons';
import { useStoryViewer } from '@/components/echo/story-viewer';
import { byDateDesc } from '@/hooks/use-social-selectors';
import { toast } from '@/hooks/use-toast';
import { AccountEditor } from '@/components/echo/account-editor';
import { VerifiedBadge } from '@/components/echo/verified-badge';
import { realFollowCounts } from '@/components/echo/account-stats';
import { HighlightsRow } from '@/components/echo/highlights';
import { getOrderedPinnedPosts } from '@/domain/social-features';
import { cn } from '@/lib/utils';
import { canViewStory, isStoryActive } from '@/domain/social-features';
import { accountTypes, shownCount, formatCount } from '@/domain/accounts';

export default function ProfilePage() {
  const t = useDiscoveryText();
  const { id } = useParams<{ id: string }>();
  const { state, me, character, actions } = useSocial();
  const [, navigate] = useLocation();
  const back = useBack();
  const { openStories } = useStoryViewer();
  const person = character(id);
  const [editing, setEditing] = useState(false);
  const [tab, setTab] = useState<'posts' | 'tagged'>('posts');
  const posts = useMemo(() => {
    const own = state.posts.filter((p) => p.authorId === id).sort(byDateDesc);
    const pinned = getOrderedPinnedPosts(state, id!).slice(0, 3);
    const pinnedIds = new Set(pinned.map(p => p.id));
    return [...pinned, ...own.filter(p => !pinnedIds.has(p.id))];
  }, [state.posts, id]);
  const tagged = useMemo(() => state.posts.filter((p) => p.authorId !== id && p.taggedAccountIds?.includes(id)).sort(byDateDesc), [state.posts, id]);

  if (!person)
    return (
      <div>
        <TopBar title={t("Perfil")} onBack={back} />
        <EmptyState title={t("Este perfil no existe")} body={t("Puede que la cuenta ya no exista en tu universo.")} />
      </div>
    );

  const isMe = person.id === me.id;
  const stories = state.stories.filter((s) => s.authorId === person.id && isStoryActive(s) && canViewStory(s, me.id, state));
  const unseen = !isMe && stories.some((s) => !s.seenBy.includes(me.id));
  const friends = (state.follows[person.id] ?? []).map(character).filter(Boolean);
  const real = realFollowCounts(state, person.id);
  const followers = shownCount(person.displayMetrics?.followers, real.followers);
  const following = shownCount(person.displayMetrics?.following, real.following);

  return (
    <div>
      <TopBar
        title={`@${person.handle}`}
        onBack={isMe ? undefined : back}
        right={
          isMe && (
            <>
              <Link href="/saved" aria-label={t("Guardados")} className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary" data-testid="link-profile-saved">
                <Bookmark className="h-[22px] w-[22px]" strokeWidth={1.6} />
              </Link>
              <Link href="/settings" aria-label={t("Ajustes")} className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary" data-testid="link-profile-settings">
                <Settings className="h-[22px] w-[22px]" strokeWidth={1.6} />
              </Link>
            </>
          )
        }
      />

      <section className="px-5 pt-6">
        <div className="flex items-center gap-5">
          <button
            onClick={() => (stories.length ? openStories(person.id, true) : undefined)}
            className="tap shrink-0 rounded-full"
            aria-label={stories.length ? `${t("Ver historias de")} ${person.name}` : person.name}
            disabled={!stories.length}
            data-testid="button-profile-avatar"
          >
            <CharacterAvatar character={person} size={88} ring={stories.length ? (stories.some(s => s.closeFriendsOnly) ? 'close-friends' : (unseen ? 'unseen' : 'seen')) : 'none'} />
          </button>
          <dl className="grid flex-1 grid-cols-3 text-center">
            <Stat value={posts.length} label={t(posts.length === 1 ? "publicación" : "publicaciones")} testId="text-count-posts" />
            <Stat value={followers} label={t("seguidores")} testId="text-count-followers" />
            <Stat value={following} label={t("seguidos")} testId="text-count-following" />
          </dl>
        </div>

        <div className="mt-4">
          <h2 className="font-display text-[19px] font-medium tracking-wide" data-testid="text-profile-name"><span className="inline-flex min-w-0 items-center gap-1.5"><span className="truncate">{person.name}</span><VerifiedBadge account={person} className="h-[18px] w-[18px] shrink-0" /></span></h2>
          <p className="text-sm text-muted-foreground">@{person.handle} · {person.occupation || accountTypes[person.accountType ?? 'personal']}</p>
          {person.archived && (
            <p className="mt-2 inline-flex items-center gap-1.5 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground" data-testid="status-profile-archived">
              <Archive className="h-3.5 w-3.5" /> {t("Cuenta archivada · historial conservado")}
            </p>
          )}
          <p className="mt-2 max-w-[440px] text-[14.5px] leading-relaxed text-foreground/90" data-testid="text-profile-bio">{person.bio}</p>
          {person.location && <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.6} /> {person.location}
          </p>}
        </div>

        {isMe ? (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <Link href="/create" className="tap col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground" data-testid="link-profile-create">
              <PlusSquare className="h-4 w-4" strokeWidth={2} /> {t("Nueva publicación")}
            </Link>
            <button onClick={() => setEditing(true)} className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold" data-testid="button-profile-edit">
              <Pencil className="h-4 w-4 shrink-0" strokeWidth={1.8} /> {t("Editar perfil")}
            </button>
            <Link href="/settings" className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold hover:bg-secondary/80" data-testid="link-profile-identity">
              <Repeat2 className="h-4 w-4 shrink-0" strokeWidth={1.8} /> {t("Cambiar identidad")}
            </Link>
            <Link href={`/characters/${person.id}/edit`} className="tap col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-foreground/90" data-testid="link-profile-character-me">
              Ficha de personaje
            </Link>
          </div>
        ) : (
          <div className="mt-5 grid grid-cols-2 gap-2">
            <button
              onClick={() => navigate(`/messages/${person.id}`)}
              className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
              data-testid="button-profile-message"
            >
              <MessageCircle className="h-4 w-4 shrink-0" strokeWidth={2} /> {t("Mensaje")}
            </button>
            <button
              disabled={person.archived}
              onClick={() => {
                actions.switchIdentity(person.id);
                toast({ title: `${t("Ahora publicas como")} ${person.name}` });
              }}
              className="tap flex h-11 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold disabled:opacity-50"
              data-testid="button-profile-become"
            >
              <Repeat2 className="h-4 w-4 shrink-0" strokeWidth={1.8} /> {t(person.archived ? 'Restaura para usar' : 'Usar este perfil')}
            </button>
            <button onClick={() => setEditing(true)} className="tap col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-foreground/90" data-testid="button-profile-edit">
              <Pencil className="h-4 w-4 shrink-0" strokeWidth={1.8} /> {t("Editar perfil")}
            </button>
            <Link href={`/characters/${person.id}/edit`} className="tap col-span-2 flex h-11 items-center justify-center gap-2 rounded-xl border border-border text-sm font-semibold text-foreground/90" data-testid="link-profile-character">
              Ficha de personaje
            </Link>
          </div>
        )}

        {friends.length > 0 && (
          <div className="mt-6 flex items-center gap-3">
            <div className="flex -space-x-2">
              {friends.map((f) => f && <CharacterAvatar key={f.id} character={f} size={24} className="rounded-full ring-2 ring-background" />)}
            </div>
            <p className="text-xs text-muted-foreground">
              Amistad con {friends.map((f, i) => f && (
                <span key={f.id}>
                  <Link href={`/profile/${f.id}`} className="font-semibold text-foreground" data-testid={`link-profile-friend-${f.id}`}>{f.name.split(' ')[0]}</Link>
                  {i < friends.length - 1 ? ' y ' : ''}
                </span>
              ))}
            </p>
          </div>
        )}
      </section>

      <div className="px-5"><HighlightsRow authorId={person.id} isMe={isMe} /></div>

      <div className="mt-6 flex justify-center border-t border-border/70" role="tablist">
        {([['posts', 'Fotos', Grid3x3], ['tagged', 'Etiquetas', UserSquare2]] as const).map(([k, label, Icon]) => (
          <button key={k} type="button" role="tab" aria-selected={tab === k} onClick={() => setTab(k)}
            className={cn('-mt-px flex h-12 items-center gap-2 border-t px-6 text-[11px] font-semibold uppercase tracking-[0.18em]', tab === k ? 'border-foreground' : 'border-transparent text-muted-foreground')}
            data-testid={`tab-profile-${k}`}>
            <Icon className="h-4 w-4" strokeWidth={1.8} /> {t(label)}
          </button>
        ))}
      </div>

      {tab === 'tagged' ? (
        tagged.length === 0
          ? <EmptyState title={isMe ? t("Nadie te etiquetó todavía") : t("Sin etiquetas")} body={t("Las publicaciones donde aparezca esta cuenta se verán aquí.")} />
          : <PhotoGrid posts={tagged} />
      ) : posts.length === 0 ? (
        <EmptyState
          title={isMe ? t("Tu cuadrícula está en blanco") : t("Aún no ha publicado")}
          body={isMe ? t('La primera foto siempre cuesta. Después ya no.') : `${person.name.split(' ')[0]} ${t('todavía no ha compartido nada.')}`}
          action={isMe && <Link href="/create" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground" data-testid="link-profile-empty-create">{t("Publicar")}</Link>}
        />
      ) : (
        <PhotoGrid posts={posts} showPinned />
      )}
      <AccountEditor open={editing} accountId={person.id} onClose={() => setEditing(false)} />
    </div>
  );
}

function Stat({ value, label, testId }: { value: number; label: string; testId: string }) {
  const shown = formatCount(value);
  return (
    <div>
      <dd className="font-display text-lg font-medium" data-testid={testId}>{shown}</dd>
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
    </div>
  );
}
