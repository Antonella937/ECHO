import type { ReactNode } from 'react';
import { ChevronLeft } from 'lucide-react';

export function TopBar({ title, onBack, right, sub }: { title: ReactNode; onBack?: () => void; right?: ReactNode; sub?: ReactNode }) {
  return (
    <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 pt-safe backdrop-blur-xl">
      <div className="flex h-14 items-center gap-1 px-2">
        {onBack ? (
          <button
            onClick={onBack}
            aria-label="Volver"
            className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary"
            data-testid="button-back"
          >
            <ChevronLeft className="h-6 w-6" strokeWidth={1.6} />
          </button>
        ) : (
          <span className="w-3" />
        )}
        <div className="min-w-0 flex-1">
          <h1 className="truncate font-display text-[17px] font-medium tracking-wide">{title}</h1>
          {sub && <div className="truncate text-xs text-muted-foreground">{sub}</div>}
        </div>
        <div className="flex items-center gap-1 pr-1">{right}</div>
      </div>
    </header>
  );
}

export function useBack() {
  return () => {
    if (window.history.length > 1) window.history.back();
    else window.location.assign(import.meta.env.BASE_URL);
  };
}
