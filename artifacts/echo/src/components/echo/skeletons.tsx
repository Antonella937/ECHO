import type { ReactNode } from 'react';
import { EchoLoader } from '../branding/echo-brand';
export function AppSkeleton() {
  return (
    <div className="min-h-[100dvh] bg-background" aria-busy="true" aria-label="Cargando ECHO">
      <div className="mx-auto max-w-[520px]">
        <div className="flex h-16 items-center justify-center">
          <EchoLoader />
        </div>
        <div className="flex gap-4 px-4 pb-5">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex flex-col items-center gap-2">
              <div className="h-[70px] w-[70px] animate-pulse rounded-full bg-card" />
              <div className="h-2 w-12 animate-pulse rounded bg-card" />
            </div>
          ))}
        </div>
        <div className="flex items-center gap-3 px-4 pb-3">
          <div className="h-9 w-9 animate-pulse rounded-full bg-card" />
          <div className="h-3 w-32 animate-pulse rounded bg-card" />
        </div>
        <div className="aspect-[4/5] w-full animate-pulse bg-card sm:rounded-[22px]" />
      </div>
    </div>
  );
}

export function EmptyState({ title, body, action }: { title: string; body: string; action?: ReactNode }) {
  return (
    <div className="flex flex-col items-center px-8 py-20 text-center" data-testid="empty-state">
      <div className="mb-5 h-14 w-14 rounded-full border border-dashed border-primary/40" />
      <p className="font-display text-xl font-light tracking-wide">{title}</p>
      <p className="mt-2 max-w-[280px] text-sm leading-relaxed text-muted-foreground">{body}</p>
      {action && <div className="mt-6">{action}</div>}
    </div>
  );
}
