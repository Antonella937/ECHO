import type { ReactNode } from 'react';

export const inputCls =
  'h-12 w-full rounded-2xl border border-border bg-background/60 px-4 text-[15px] outline-none transition-colors placeholder:text-muted-foreground/60 focus:border-primary/60';

export function Field({ id, label, hint, children }: { id: string; label: string; hint?: ReactNode; children: ReactNode }) {
  return (
    <div className="mt-4">
      <label htmlFor={id} className="mb-1.5 block px-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</label>
      {children}
      {hint && <p className="mt-1.5 px-1 text-[12px] leading-relaxed text-muted-foreground">{hint}</p>}
    </div>
  );
}

/** Blank string -> null (base reset). */
export function parseBase(v: string): number | null {
  const t = v.trim().replace(/\./g, '');
  if (!t) return null;
  const n = Number(t);
  if (!Number.isSafeInteger(n) || n < 0) throw new Error('Las cifras base deben ser números enteros positivos o quedar vacías.');
  return n;
}
