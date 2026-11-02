import { useMemo, useState } from 'react';
import { Link, useLocation } from 'wouter';
import { PenSquare, Search } from 'lucide-react';
import { VerifiedBadge } from '@/components/echo/verified-badge';
import { useSocial } from '@/store/social-store';
import { useThreads } from '@/hooks/use-social-selectors';
import { TopBar } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { Sheet } from '@/components/echo/sheet';
import { timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';

const normalize = (s: string) => s.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLowerCase();

export default function MessagesPage() {
  const { me } = useSocial();
  const threads = useThreads();
  const [composing, setComposing] = useState(false);

  return (
    <div>
      <TopBar
        title="Mensajes"
        sub={`Bandeja de ${me.name}`}
        right={
          <button
            onClick={() => setComposing(true)}
            aria-label="Nueva conversación"
            className="tap flex h-11 items-center gap-2 rounded-full bg-secondary px-4 text-sm font-semibold hover:bg-secondary/80"
            data-testid="button-new-conversation"
          >
            <PenSquare className="h-[18px] w-[18px] shrink-0" strokeWidth={1.8} />
            <span className="hidden min-[380px]:inline">Nueva</span>
          </button>
        }
      />
      {threads.length === 0 ? (
        <div className="flex flex-col items-center px-8 py-20 text-center" data-testid="empty-messages">
          <div className="mb-5 grid h-16 w-16 place-items-center rounded-full border border-dashed border-primary/40 text-primary">
            <PenSquare className="h-6 w-6" strokeWidth={1.5} />
          </div>
          <p className="font-display text-xl font-light tracking-wide">Aún no hay mensajes</p>
          <p className="mt-2 max-w-[280px] text-sm leading-relaxed text-muted-foreground">
            Escribe a alguien de tu universo. La conversación aparecerá aquí cuando envíes el primer mensaje.
          </p>
          <button
            onClick={() => setComposing(true)}
            className="tap mt-6 inline-flex h-11 items-center gap-2 rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground"
            data-testid="button-empty-new-conversation"
          >
            <PenSquare className="h-4 w-4" strokeWidth={2} /> Nueva conversación
          </button>
        </div>
      ) : (
        <ul className="px-1 pt-3" data-testid="list-threads">
          {threads.map(({ other, last, unread }) => (
            <li key={other.id}>
              <Link href={`/messages/${other.id}`} className="flex min-h-[72px] items-center gap-3.5 rounded-2xl px-3 py-3 hover:bg-secondary/60" data-testid={`link-thread-${other.id}`}>
                <CharacterAvatar character={other} size={52} />
                <div className="min-w-0 flex-1">
                  <div className={cn('flex min-w-0 items-center gap-1 text-[15px]', unread ? 'font-semibold' : 'font-medium')}>
                    <span className="truncate">{other.name}</span>
                    <VerifiedBadge account={other} className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div className={cn('truncate text-[13.5px]', unread ? 'text-foreground' : 'text-muted-foreground')}>
                    {last
                      ? `${last.senderId === me.id ? 'Tú: ' : ''}${last.storyId ? 'Respondió a una historia · ' : last.postId ? 'Compartió una foto · ' : ''}${last.text || (last.attachments?.length ? (last.attachments[0].type === 'image' ? 'Foto' : last.attachments[0].type === 'video' ? 'Video' : 'Nota de voz') : '')}`
                      : `@${other.handle}`}
                    {last && <span className="text-muted-foreground"> · {timeAgo(last.createdAt)}</span>}
                  </div>
                </div>
                {unread > 0 && (
                  <span className="grid h-5 min-w-5 shrink-0 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground" data-testid={`badge-unread-${other.id}`}>
                    {unread}
                  </span>
                )}
              </Link>
            </li>
          ))}
        </ul>
      )}
      <p className="px-6 pt-6 text-center text-[11.5px] leading-relaxed text-muted-foreground/70">
        Los personajes aún no responden solos: lo que envíes queda guardado en la conversación.
      </p>
      <NewConversationSheet open={composing} onClose={() => setComposing(false)} />
    </div>
  );
}

function NewConversationSheet({ open, onClose }: { open: boolean; onClose(): void }) {
  const { state, me } = useSocial();
  const [, navigate] = useLocation();
  const [q, setQ] = useState('');
  const accounts = useMemo(() => {
    const term = normalize(q.trim().replace(/^@/, ''));
    return state.characters
      .filter((c) => c.id !== me.id && !c.archived)
      .filter((c) => !term || normalize(c.name).includes(term) || normalize(c.handle).includes(term))
      .sort((a, b) => a.name.localeCompare(b.name, 'es'));
  }, [state.characters, me.id, q]);

  const close = () => {
    setQ('');
    onClose();
  };

  return (
    <Sheet open={open} onClose={close} title="Nueva conversación" testId="sheet-new-conversation">
      <label className="sticky top-0 z-10 -mx-1 mb-2 flex items-center gap-2 rounded-2xl border border-input bg-background px-4">
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" strokeWidth={1.8} />
        <input
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Buscar por nombre o @usuario"
          aria-label="Buscar cuenta"
          className="h-11 min-w-0 flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none"
          data-testid="input-search-accounts"
        />
      </label>
      {accounts.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground" data-testid="text-no-accounts">
          {q ? 'Ninguna cuenta coincide con tu búsqueda.' : 'No hay otras cuentas activas.'}
        </p>
      ) : (
        <ul className="flex flex-col">
          {accounts.map((c) => (
            <li key={c.id}>
              <button
                onClick={() => {
                  close();
                  navigate(`/messages/${c.id}`);
                }}
                className="tap flex min-h-[60px] w-full items-center gap-3 rounded-2xl px-2 py-2 text-left hover:bg-secondary/70"
                data-testid={`button-choose-account-${c.id}`}
              >
                <CharacterAvatar character={c} size={44} />
                <div className="min-w-0 flex-1">
                  <div className="flex min-w-0 items-center gap-1 text-[15px] font-medium">
                    <span className="truncate">{c.name}</span>
                    <VerifiedBadge account={c} className="h-3.5 w-3.5 shrink-0" />
                  </div>
                  <div className="truncate text-xs text-muted-foreground">@{c.handle}</div>
                </div>
              </button>
            </li>
          ))}
        </ul>
      )}
    </Sheet>
  );
}
