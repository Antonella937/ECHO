import { useMemo, useState } from 'react';
import { Check, ChevronDown, Search, X } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { cn } from '@/lib/utils';

/** Searchable multi-account selector for post tags and story mentions. */
export function AccountPicker({ value, onChange, excludeId, label, testIdPrefix }: {
  value: string[]; onChange(ids: string[]): void; excludeId?: string; label: string; testIdPrefix: string;
}) {
  const { state } = useSocial();
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const accounts = useMemo(() => state.characters.filter((c) => c.id !== excludeId && (!c.archived || value.includes(c.id))), [state.characters, excludeId, value]);
  const selected = accounts.filter((c) => value.includes(c.id));
  const matches = accounts.filter((c) => (c.name + ' ' + c.handle).toLocaleLowerCase().includes(query.trim().toLocaleLowerCase()));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  if (!accounts.length) return null;

  return (
    <div className="mt-3">
      <button type="button" onClick={() => setOpen((v) => !v)} aria-expanded={open}
        className="flex min-h-12 w-full items-center gap-3 rounded-2xl border border-input bg-card px-4 text-left text-sm"
        data-testid={`${testIdPrefix}-open`}>
        <Search className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="flex-1">{label}{selected.length ? ` · ${selected.length}` : ''}</span>
        <ChevronDown className={cn('h-4 w-4 text-muted-foreground transition-transform', open && 'rotate-180')} />
      </button>
      {selected.length > 0 && (
        <div className="mt-2 flex flex-wrap gap-2" aria-label={label}>
          {selected.map((c) => (
            <button key={c.id} type="button" onClick={() => toggle(c.id)}
              className="flex items-center gap-1.5 rounded-full border border-primary/40 bg-primary/10 py-1 pl-1 pr-2 text-xs"
              aria-label={`Remove @${c.handle}`} data-testid={`${testIdPrefix}-remove-${c.id}`}>
              <CharacterAvatar character={c} size={24} /> @{c.handle} <X className="h-3 w-3" />
            </button>
          ))}
        </div>
      )}
      {open && (
        <div className="mt-2 overflow-hidden rounded-2xl border border-border bg-card">
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-4 w-4 text-muted-foreground" />
            <input autoFocus type="search" value={query} onChange={(e) => setQuery(e.target.value)}
              placeholder="Search / Buscar cuenta..." aria-label={label}
              className="h-11 min-w-0 flex-1 bg-transparent text-sm outline-none" />
          </div>
          <div className="max-h-56 overflow-y-auto p-1" role="group" aria-label={label}>
            {matches.length === 0 && <p className="px-3 py-4 text-center text-sm text-muted-foreground">No accounts found / Sin resultados</p>}
            {matches.map((c) => {
              const active = value.includes(c.id);
              return (
                <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={active}
                  className={cn('flex w-full items-center gap-3 rounded-xl px-3 py-2 text-left text-sm hover:bg-secondary', active && 'bg-primary/10')}
                  data-testid={`${testIdPrefix}-${c.id}`}>
                  <CharacterAvatar character={c} size={32} />
                  <span className="min-w-0 flex-1 truncate"><span className="block truncate font-medium">{c.name}</span><span className="block truncate text-xs text-muted-foreground">@{c.handle}</span></span>
                  {active && <Check className="h-4 w-4 shrink-0 text-primary" />}
                </button>
              );
            })}
          </div>
          <button type="button" onClick={() => { setOpen(false); setQuery(''); }}
            className="w-full border-t border-border py-2.5 text-sm font-medium text-primary">Done / Listo</button>
        </div>
      )}
    </div>
  );
}
