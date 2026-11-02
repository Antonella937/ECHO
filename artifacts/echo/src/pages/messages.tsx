import { VerifiedBadge } from '@/components/echo/verified-badge';
import { Link } from 'wouter';
import { useSocial } from '@/store/social-store';
import { useThreads } from '@/hooks/use-social-selectors';
import { TopBar } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';

export default function MessagesPage() {
  const { me } = useSocial();
  const threads = useThreads();
  return (
    <div>
      <TopBar title="Mensajes" sub={`Bandeja de ${me.name}`} />
      <ul className="px-1 pt-3">
        {threads.map(({ other, last, unread }) => (
          <li key={other.id}>
            <Link href={`/messages/${other.id}`} className="flex items-center gap-3.5 rounded-2xl px-3 py-3 hover:bg-secondary/60" data-testid={`link-thread-${other.id}`}>
              <CharacterAvatar character={other} size={54} />
              <div className="min-w-0 flex-1">
                <div className={cn('truncate text-[15px]', unread ? 'font-semibold' : 'font-medium')}><span className="inline-flex items-center gap-1">{other.name}<VerifiedBadge account={other} className="h-3.5 w-3.5" /></span></div>
                <div className={cn('truncate text-[13.5px]', unread ? 'text-foreground' : 'text-muted-foreground')}>
                  {last
                    ? `${last.senderId === me.id ? 'Tú: ' : ''}${last.storyId ? 'Respondió a una historia · ' : last.postId ? 'Compartió una foto · ' : ''}${last.text}`
                    : 'Empieza la conversación'}
                  {last && <span className="text-muted-foreground"> · {timeAgo(last.createdAt)}</span>}
                </div>
              </div>
              {unread > 0 && (
                <span className="grid h-5 min-w-5 place-items-center rounded-full bg-primary px-1.5 text-[11px] font-bold text-primary-foreground" data-testid={`badge-unread-${other.id}`}>
                  {unread}
                </span>
              )}
            </Link>
          </li>
        ))}
      </ul>
      <p className="px-6 pt-6 text-center text-[11.5px] leading-relaxed text-muted-foreground/70">
        Los personajes aún no responden solos: lo que envíes queda guardado en la conversación.
      </p>
    </div>
  );
}
