import { useSharedShellText } from '@/lib/shared-shell-translations';
import type { ReactNode } from 'react';
import { Link, useLocation } from 'wouter';
import { Bell, Bookmark, Home, Palette, PlusSquare, Send, Settings } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { cn } from '@/lib/utils';
import { useTranslation } from '@/lib/i18n';
import { useUnreadCounts } from '@/hooks/use-social-selectors';

export function Shell({ children }: { children: ReactNode }) {
  const [location] = useLocation();
  const t = useTranslation();
  const shared = useSharedShellText();
  const { me, state, character } = useSocial();
  const { notifications, messages } = useUnreadCounts();
  const inConversation = /^\/messages\/.+/.test(location);
  // Creator Hub is a full-screen destination, not a feed panel.
  if (location === '/creator-hub') return <div className="grain min-h-[100dvh] bg-background text-foreground">{children}</div>;

  const items = [
    { href: '/', label: t('home'), icon: Home, match: (l: string) => l === '/' },
    { href: '/messages', label: t('messages'), icon: Send, badge: messages, match: (l: string) => l.startsWith('/messages') },
    { href: '/create', label: t('create'), icon: PlusSquare, match: (l: string) => l.startsWith('/create') },
    { href: '/notifications', label: t('notifications'), icon: Bell, badge: notifications, match: (l: string) => l.startsWith('/notifications') },
  ];
  const profileActive = location === `/profile/${me.id}`;
  const friends = (state.follows[me.id] ?? []).map(character).filter(Boolean);

  return (
    <div className="grain min-h-[100dvh] bg-background text-foreground lg:grid lg:grid-cols-[248px_minmax(0,1fr)] xl:grid-cols-[248px_minmax(0,1fr)_300px]">
      {/* Desktop rail */}
      <aside className="sticky top-0 hidden h-[100dvh] min-h-0 flex-col overflow-y-auto border-r border-border/70 px-4 py-8 lg:flex">
        <Link href="/" className="wordmark px-3 text-[26px] text-foreground" data-testid="link-wordmark-rail">
          ECHO
        </Link>
        <nav className="mt-10 flex flex-col gap-1">
          {items.map((it) => {
            const active = it.match(location);
            return (
              <Link
                key={it.href}
                href={it.href}
                className={cn(
                  'flex h-12 items-center gap-4 rounded-2xl px-3 text-[15px] transition-colors hover:bg-secondary',
                  active ? 'font-semibold text-foreground' : 'text-muted-foreground',
                )}
                data-testid={`link-rail-${it.label.toLowerCase()}`}
              >
                <span className="relative">
                  <it.icon className="h-6 w-6" strokeWidth={active ? 2 : 1.6} />
                  {!!it.badge && <Dot />}
                </span>
                {it.label}
              </Link>
            );
          })}
          <Link
            href="/saved"
            className={cn('flex h-12 items-center gap-4 rounded-2xl px-3 text-[15px] hover:bg-secondary', location === '/saved' ? 'font-semibold' : 'text-muted-foreground')}
            data-testid="link-rail-saved"
          >
            <Bookmark className="h-6 w-6" strokeWidth={1.6} /> {t('saved')}
          </Link>
          <Link
            href={`/profile/${me.id}`}
            className={cn('flex h-12 items-center gap-4 rounded-2xl px-3 text-[15px] hover:bg-secondary', profileActive ? 'font-semibold' : 'text-muted-foreground')}
            data-testid="link-rail-profile"
          >
            <CharacterAvatar character={me} size={26} /> {t('profile')}
          </Link>
        </nav>
        <div className="mt-auto">
          <Link href="/settings" className="flex h-12 items-center gap-4 rounded-2xl px-3 text-[15px] text-muted-foreground hover:bg-secondary" data-testid="link-rail-settings">
            <Settings className="h-6 w-6" strokeWidth={1.6} /> {t('settings')}
          </Link>
        </div>
      </aside>

      <main className={cn('mx-auto min-w-0 w-full max-w-[520px] lg:max-w-[600px]', !inConversation && 'pb-nav lg:pb-10')}>{children}</main>

      {/* Desktop right column */}
      <aside className="sticky top-0 hidden h-[100dvh] min-h-0 flex-col gap-6 overflow-y-auto px-6 py-10 xl:flex">
        <div className="rounded-3xl border border-card-border bg-card p-4">
          <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{shared("Publicando como")}</div>
          <Link href={`/profile/${me.id}`} className="mt-3 flex items-center gap-3" data-testid="link-current-identity">
            <CharacterAvatar character={me} size={44} />
            <div className="min-w-0">
              <div className="truncate text-sm font-semibold">{me.name}</div>
              <div className="truncate text-xs text-muted-foreground">@{me.handle}</div>
            </div>
          </Link>
          <Link href="/settings" className="mt-3 inline-block text-xs text-primary hover:underline" data-testid="link-switch-identity-aside">
            {shared('Cambiar identidad')}
          </Link>
        </div>
        <div>
          <div className="mb-3 px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{shared("Amistades")}</div>
          <div className="flex flex-col gap-1">
            {friends.map((f) =>
              f ? (
                <Link key={f.id} href={`/profile/${f.id}`} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-secondary" data-testid={`link-friend-${f.id}`}>
                  <CharacterAvatar character={f} size={36} />
                  <div className="min-w-0">
                    <div className="truncate text-sm font-medium">{f.name}</div>
                    <div className="truncate text-xs text-muted-foreground">{f.occupation} · {f.location}</div>
                  </div>
                </Link>
              ) : null,
            )}
          </div>
        </div>
        <div className="mt-auto space-y-4 pt-6">
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground/70">
          {state.creatorSetup ? `${shared('Universo privado: ')}${state.creatorSetup.universeName}.` : shared('Universo privado.')} {shared('Los personajes y sus respuestas todavía son simulados.')}
        </p>
        <Link href="/creator-hub" aria-label="Creator Hub" className="flex min-h-11 items-center gap-2 rounded-full border border-primary/20 bg-primary/10 px-4 text-xs font-semibold text-primary transition-colors hover:bg-primary/20" data-testid="link-aside-creator-hub"><Palette className="h-5 w-5" strokeWidth={1.7} /><span>Creator Hub</span></Link>
        </div>
      </aside>

      {/* Mobile bottom nav */}
      {!inConversation && (
        <nav className="echo-dark-surface fixed inset-x-0 bottom-0 z-40 px-3 pb-[max(env(safe-area-inset-bottom,0px),0.25rem)] lg:hidden" aria-label={shared("Navegación principal")} data-testid="nav-mobile">
          <div className="mx-auto mb-0 flex h-[var(--nav-height)] max-w-[440px] items-center justify-around rounded-[26px] border border-border/80 bg-[hsl(240_4%_8%/0.88)] shadow-lg backdrop-blur-xl">
            {items.map((it) => {
              const active = it.match(location);
              return (
                <Link
                  key={it.href}
                  href={it.href}
                  aria-label={it.label}
                  className={cn('tap relative grid h-12 w-12 place-items-center rounded-full', active ? 'text-foreground' : 'text-muted-foreground')}
                  data-testid={`link-nav-${it.label.toLowerCase()}`}
                >
                  <it.icon className="h-[25px] w-[25px]" strokeWidth={active ? 2 : 1.5} />
                  {!!it.badge && <Dot />}
                  {active && <span className="absolute bottom-0.5 h-1 w-1 rounded-full bg-primary" />}
                </Link>
              );
            })}
            <Link
              href={`/profile/${me.id}`}
              aria-label={t('profile')}
              className="tap grid h-12 w-12 place-items-center"
              data-testid="link-nav-profile"
            >
              <span className={cn('rounded-full p-[2px]', profileActive ? 'bg-foreground' : 'bg-transparent')}>
                <CharacterAvatar character={me} size={26} />
              </span>
            </Link>
          </div>
        </nav>
      )}
    </div>
  );
}

function Dot() {
  return <span className="absolute right-0.5 top-0.5 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />;
}
