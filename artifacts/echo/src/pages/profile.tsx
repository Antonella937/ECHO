import { useMemo } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { Bookmark, Grid3x3, MapPin, MessageCircle, Repeat2, Settings } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { PhotoGrid } from '@/components/echo/photo-grid';
import { EmptyState } from '@/components/echo/skeletons';
import { useStoryViewer } from '@/components/echo/story-viewer';
import { byDateDesc } from '@/hooks/use-social-selectors';
import { toast } from '@/hooks/use-toast';

export default function ProfilePage() {
  const { id } = useParams<{ id: string }>();
  const { state, me, character, actions } = useSocial();
  const [, navigate] = useLocation();
  const back = useBack();
  const { openStories } = useStoryViewer();
  const person = character(id);
  const posts = useMemo(() => state.posts.filter((p) => p.authorId === id).sort(byDateDesc), [state.posts, id]);

  if (!person)
    return (
      <div>
        <TopBar title="Perfil" onBack={back} />
        <EmptyState title="Este perfil no existe" body="En ECHO solo viven tres personajes por ahora." />
      </div>
    );

  const isMe = person.id === me.id;
  const stories = state.stories.filter((s) => s.authorId === person.id);
  const unseen = !isMe && stories.some((s) => !s.seenBy.includes(me.id));
  const friends = (state.follows[person.id] ?? []).map(character).filter(Boolean);

  return (
    <div>
      <TopBar
        title={person.handle}
        onBack={isMe ? undefined : back}
        right={
          isMe && (
            <>
              <Link href="/saved" aria-label="Guardados" className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary" data-testid="link-profile-saved">
                <Bookmark className="h-[22px] w-[22px]" strokeWidth={1.6} />
              </Link>
              <Link href="/settings" aria-label="Ajustes" className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary" data-testid="link-profile-settings">
                <Settings className="h-[22px] w-[22px]" strokeWidth={1.6} />
              </Link>
            </>
          )
        }
      />

      <section className="px-5 pt-6">
        <div className="flex items-center gap-6">
          <button
            onClick={() => (stories.length ? openStories(person.id, true) : undefined)}
            className="tap rounded-full"
            aria-label={stories.length ? `Ver historias de ${person.name}` : person.name}
            disabled={!stories.length}
            data-testid="button-profile-avatar"
          >
            <CharacterAvatar character={person} size={92} ring={stories.length ? (unseen ? 'unseen' : 'seen') : 'none'} />
          </button>
          <dl className="grid flex-1 grid-cols-3 text-center">
            <Stat value={posts.length} label="publicaciones" testId="text-count-posts" />
            <Stat value={friends.length} label="amistades" testId="text-count-friends" />
            <Stat value={stories.length} label="historias" testId="text-count-stories" />
          </dl>
        </div>

        <div className="mt-4">
          <h2 className="font-display text-[19px] font-medium tracking-wide" data-testid="text-profile-name">{person.name}</h2>
          <p className="text-sm text-muted-foreground">{person.occupation}</p>
          <p className="mt-2 max-w-[440px] text-[14.5px] leading-relaxed text-foreground/90" data-testid="text-profile-bio">{person.bio}</p>
          <p className="mt-2 flex items-center gap-1.5 text-xs text-muted-foreground">
            <MapPin className="h-3.5 w-3.5" strokeWidth={1.6} /> {person.location}
          </p>
        </div>

        <div className="mt-5 flex gap-2">
          {isMe ? (
            <>
              <Link href="/create" className="grid h-10 flex-1 place-items-center rounded-xl bg-secondary text-sm font-semibold hover:bg-secondary/80" data-testid="link-profile-create">
                Nueva publicación
              </Link>
              <Link href="/settings" className="grid h-10 flex-1 place-items-center rounded-xl bg-secondary text-sm font-semibold hover:bg-secondary/80" data-testid="link-profile-identity">
                Cambiar identidad
              </Link>
            </>
          ) : (
            <>
              <button
                onClick={() => navigate(`/messages/${person.id}`)}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-primary text-sm font-semibold text-primary-foreground"
                data-testid="button-profile-message"
              >
                <MessageCircle className="h-4 w-4" strokeWidth={2} /> Mensaje
              </button>
              <button
                onClick={() => {
                  actions.switchIdentity(person.id);
                  toast({ title: `Ahora publicas como ${person.name}` });
                }}
                className="flex h-10 flex-1 items-center justify-center gap-2 rounded-xl bg-secondary text-sm font-semibold"
                data-testid="button-profile-become"
              >
                <Repeat2 className="h-4 w-4" strokeWidth={1.8} /> Usar este perfil
              </button>
            </>
          )}
        </div>

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

      <div className="mt-6 flex justify-center border-t border-border/70">
        <span className="-mt-px flex h-12 items-center gap-2 border-t border-foreground px-6 text-[11px] font-semibold uppercase tracking-[0.18em]">
          <Grid3x3 className="h-4 w-4" strokeWidth={1.8} /> Fotos
        </span>
      </div>

      {posts.length === 0 ? (
        <EmptyState
          title={isMe ? 'Tu cuadrícula está en blanco' : 'Aún no ha publicado'}
          body={isMe ? 'La primera foto siempre cuesta. Después ya no.' : `${person.name.split(' ')[0]} todavía no ha compartido nada.`}
          action={isMe && <Link href="/create" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground" data-testid="link-profile-empty-create">Publicar</Link>}
        />
      ) : (
        <PhotoGrid posts={posts} />
      )}
    </div>
  );
}

function Stat({ value, label, testId }: { value: number; label: string; testId: string }) {
  return (
    <div>
      <dd className="font-display text-lg font-medium" data-testid={testId}>{value}</dd>
      <dt className="text-[11.5px] text-muted-foreground">{label}</dt>
    </div>
  );
}
