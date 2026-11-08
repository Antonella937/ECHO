import { useFeedText } from '@/lib/feed-translations';
import { Link } from 'wouter';
import { Bell, Plus, Send } from 'lucide-react';
import { StoryRail } from '@/components/echo/story-rail';
import { PostCard } from '@/components/echo/post-card';
import { EmptyState } from '@/components/echo/skeletons';
import { useFeed, useUnreadCounts } from '@/hooks/use-social-selectors';

export default function HomePage() {
  const t = useFeedText();
  const feed = useFeed();
  const { notifications, messages } = useUnreadCounts();

  return (
    <div>
      <header className="sticky top-0 z-30 bg-background pt-[calc(env(safe-area-inset-top,0px)+12px)] lg:pt-0">
        <div className="relative flex h-16 items-center justify-center px-3">
          <h1 className="wordmark text-[30px] leading-none text-foreground" data-testid="text-wordmark">ECHO</h1>
          <Link href="/create" aria-label={t("Crear publicación")} className="tap absolute left-2 grid h-11 w-11 place-items-center rounded-full lg:hidden" data-testid="link-header-create">
            <Plus className="h-7 w-7" strokeWidth={1.7} />
          </Link>
          <div className="absolute right-2 flex items-center lg:hidden">
            <Link href="/notifications" aria-label={t("Avisos")} className="tap relative grid h-11 w-11 place-items-center rounded-full" data-testid="link-header-notifications">
              <Bell className="h-6 w-6" strokeWidth={1.5} />
              {notifications > 0 && <span className="absolute right-2 top-2 h-2 w-2 rounded-full bg-primary ring-2 ring-background" />}
            </Link>
            <Link href="/messages" aria-label={t("Mensajes")} className="tap relative grid h-11 w-11 place-items-center rounded-full" data-testid="link-header-messages">
              <Send className="h-[23px] w-[23px]" strokeWidth={1.5} />
              {messages > 0 && (
                <span className="absolute right-0.5 top-1 grid h-[18px] min-w-[18px] place-items-center rounded-full bg-primary px-1 text-[10.5px] font-bold text-primary-foreground ring-2 ring-background">
                  {messages}
                </span>
              )}
            </Link>
          </div>
        </div>
      </header>

      <div className="pt-1 lg:pt-6">
        <StoryRail />
        <div className="mx-4 mb-5 h-px bg-border/60" />
        {feed.length === 0 ? (
          <EmptyState
            title={t("Un silencio raro")}
            body={t("No hay publicaciones todavía. Comparte la primera foto de este pequeño universo.")}
            action={<Link href="/create" className="inline-flex h-11 items-center rounded-full bg-primary px-6 text-sm font-semibold text-primary-foreground" data-testid="link-empty-create">{t("Crear publicación")}</Link>}
          />
        ) : (
          feed.map((p, i) => <PostCard key={p.id} post={p} eager={i < 2} />)
        )}
        {feed.length > 0 && (
          <p className="pb-6 pt-2 text-center text-xs tracking-[0.2em] text-muted-foreground/60">{t("ESTÁS AL DÍA")}</p>
        )}
      </div>
    </div>
  );
}
