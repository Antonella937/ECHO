import { Check } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { cn } from '@/lib/utils';

/** Multi-account selector used for post tags and story mentions. */
export function AccountPicker({ value, onChange, excludeId, label, testIdPrefix }: {
  value: string[]; onChange(ids: string[]): void; excludeId?: string; label: string; testIdPrefix: string;
}) {
  const { state } = useSocial();
  const accounts = state.characters.filter((c) => c.id !== excludeId && (!c.archived || value.includes(c.id)));
  const toggle = (id: string) => onChange(value.includes(id) ? value.filter((v) => v !== id) : [...value, id]);
  if (!accounts.length) return null;
  return (
    <fieldset className="mt-3 rounded-2xl border border-border px-3 py-3">
      <legend className="px-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}{value.length ? ` · ${value.length}` : ''}</legend>
      <div className="no-scrollbar flex gap-2 overflow-x-auto">
        {accounts.map((c) => {
          const on = value.includes(c.id);
          return (
            <button key={c.id} type="button" onClick={() => toggle(c.id)} aria-pressed={on}
              className={cn('flex h-11 shrink-0 items-center gap-2 rounded-full border pl-1 pr-3 text-xs font-semibold transition-colors', on ? 'border-primary bg-primary/15 text-foreground' : 'border-border text-muted-foreground')}
              data-testid={`${testIdPrefix}-${c.id}`}>
              <CharacterAvatar character={c} size={32} />
              @{c.handle}
              {on && <Check className="h-3.5 w-3.5 text-primary" />}
            </button>
          );
        })}
      </div>
    </fieldset>
  );
}
