import { useEffect, useRef, useState, type ReactNode } from 'react';
import { Field, inputCls } from '@/components/echo/field';
import { cn } from '@/lib/utils';
import type { CharacterConfig } from '@/domain/character-core';

export type Cfg = CharacterConfig;
export type SetCfg = (fn: (c: Cfg) => Cfg) => void;
export interface SectionProps { config: Cfg; set: SetCfg }

export const uid = () => (typeof crypto !== 'undefined' && 'randomUUID' in crypto ? crypto.randomUUID() : `id-${Date.now()}-${Math.random().toString(36).slice(2)}`);
export const areaCls = cn(inputCls, 'h-auto min-h-[96px] resize-y py-3 leading-relaxed');

export function Text({ id, label, value, onChange, max, hint, testId, placeholder }: {
  id: string; label: string; value: string; onChange(v: string): void; max: number; hint?: ReactNode; testId?: string; placeholder?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <input id={id} value={value} maxLength={max} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={inputCls} autoComplete="off" data-testid={testId ?? `input-${id}`} />
    </Field>
  );
}

export function Area({ id, label, value, onChange, max, rows = 4, hint, testId, placeholder }: {
  id: string; label: string; value: string; onChange(v: string): void; max: number; rows?: number; hint?: ReactNode; testId?: string; placeholder?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint ?? `${value.length.toLocaleString('es')}/${max.toLocaleString('es')}`}>
      <textarea id={id} value={value} maxLength={max} rows={rows} placeholder={placeholder} onChange={(e) => onChange(e.target.value)} className={areaCls} data-testid={testId ?? `input-${id}`} />
    </Field>
  );
}

/** Free list editor. Keeps the raw text while typing; splits by line (and commas when `comma`). */
export function ListInput({ id, label, value, onChange, comma = true, max = 50, hint }: {
  id: string; label: string; value: string[]; onChange(v: string[]): void; comma?: boolean; max?: number; hint?: string;
}) {
  const [raw, setRaw] = useState(() => value.join(comma ? ', ' : '\n'));
  const last = useRef(JSON.stringify(value));
  useEffect(() => {
    if (JSON.stringify(value) !== last.current) {
      setRaw(value.join(comma ? ', ' : '\n'));
      last.current = JSON.stringify(value);
    }
  }, [value, comma]);
  const parse = (t: string) => t.split(comma ? /[\n,]/ : /\n/).map((s) => s.trim()).filter(Boolean).slice(0, max);
  return (
    <Field id={id} label={label} hint={hint ?? `${comma ? 'Separá con comas o saltos de línea' : 'Una por línea'} · ${value.length}/${max}`}>
      <textarea id={id} value={raw} rows={comma ? 2 : 3} onChange={(e) => { const next = parse(e.target.value); setRaw(e.target.value); last.current = JSON.stringify(next); onChange(next); }} className={cn(areaCls, 'min-h-[64px]')} data-testid={`input-${id}`} />
    </Field>
  );
}

export function Select<T extends string>({ id, label, value, onChange, options, hint }: {
  id: string; label: string; value: T; onChange(v: T): void; options: Record<T, string>; hint?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value as T)} className={inputCls} data-testid={`select-${id}`}>
        {(Object.keys(options) as T[]).map((k) => <option key={k} value={k}>{options[k]}</option>)}
      </select>
    </Field>
  );
}

export function NumberInput({ id, label, value, onChange, min, max, hint }: {
  id: string; label: string; value: number | null; onChange(v: number | null): void; min: number; max: number; hint?: string;
}) {
  return (
    <Field id={id} label={label} hint={hint}>
      <input id={id} type="number" inputMode="numeric" min={min} max={max} value={value ?? ''} placeholder="Sin definir"
        onChange={(e) => { const t = e.target.value; if (!t) return onChange(null); const n = Math.round(Number(t)); if (Number.isFinite(n)) onChange(Math.min(max, Math.max(min, n))); }}
        className={inputCls} data-testid={`input-${id}`} />
    </Field>
  );
}

export function Slider({ id, label, value, onChange }: { id: string; label: string; value: number; onChange(v: number): void }) {
  return (
    <div className="mt-3">
      <label htmlFor={id} className="flex justify-between px-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"><span>{label}</span><span className="tabular-nums text-foreground">{value}</span></label>
      <input id={id} type="range" min={0} max={100} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 h-11 w-full accent-[hsl(var(--primary))]" data-testid={`slider-${id}`} />
    </div>
  );
}

export function Toggle({ id, label, checked, onChange }: { id: string; label: string; checked: boolean; onChange(v: boolean): void }) {
  return (
    <label htmlFor={id} className="mt-4 flex min-h-12 cursor-pointer items-center justify-between gap-3 rounded-2xl border border-border px-4">
      <span className="text-sm">{label}</span>
      <input id={id} type="checkbox" checked={checked} onChange={(e) => onChange(e.target.checked)} className="h-5 w-5 accent-[hsl(var(--primary))]" data-testid={`checkbox-${id}`} />
    </label>
  );
}

export function Note({ children }: { children: ReactNode }) {
  return <p className="mt-3 rounded-2xl bg-accent/30 p-3 text-[13px] leading-relaxed text-muted-foreground">{children}</p>;
}

export function SubHead({ children }: { children: ReactNode }) {
  return <h3 className="mt-7 px-1 font-display text-[15px] tracking-wide text-foreground">{children}</h3>;
}

export function GhostButton({ onClick, children, testId, danger }: { onClick(): void; children: ReactNode; testId: string; danger?: boolean }) {
  return (
    <button type="button" onClick={onClick} data-testid={testId}
      className={cn('tap inline-flex min-h-11 items-center justify-center gap-1.5 rounded-xl border px-3 text-xs font-semibold', danger ? 'border-destructive/40 text-destructive' : 'border-border text-muted-foreground hover:text-foreground')}>
      {children}
    </button>
  );
}

export const level = { low: 'Baja', medium: 'Media', high: 'Alta' } as const;
export const freq = { rare: 'Poco', normal: 'Normal', frequent: 'Seguido' } as const;
