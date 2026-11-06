import { useAccountManagementText } from '@/lib/account-management-translations';
import { useState } from 'react';
import { X } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';

/** Compact searchable multi-select of accounts (tags / story mentions). */
export function AccountMultiPicker({ value, onChange, label, excludeId, max = 20, testId }: {
  value: string[]; onChange(ids: string[]): void; label: string; excludeId?: string; max?: number; testId: string;
}) {
  const t = useAccountManagementText();
  const { state, character } = useSocial();
  const [q, setQ] = useState('');
  const query = q.trim().toLowerCase().replace(/^@/, '');
  const options = state.characters.filter((c) => !c.archived && c.id !== excludeId && !value.includes(c.id) &&
    (!query || c.handle.toLowerCase().includes(query) || c.name.toLowerCase().includes(query))).slice(0, 6);
  return (
    <div className="rounded-2xl border border-input bg-card px-3 py-2.5" data-testid={testId}>
      <div className="mb-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{label}</div>
      {value.length > 0 && (
        <div className="mb-2 flex flex-wrap gap-1.5">
          {value.map((id) => {
            const c = character(id);
            return (
              <button key={id} type="button" onClick={() => onChange(value.filter((v) => v !== id))} className="flex h-8 items-center gap-1.5 rounded-full bg-accent pl-1 pr-2.5 text-xs font-semibold text-accent-foreground" aria-label={`${t('Quitar ')}${c?.handle ?? id}`} data-testid={`${testId}-remove-${id}`}>
                {c && <CharacterAvatar character={c} size={22} />}@{c?.handle ?? t('cuenta')} <X className="h-3 w-3" />
              </button>
            );
          })}
        </div>
      )}
      {value.length < max && (
        <>
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder={t("Buscar cuenta…")} aria-label={label}
            className="h-10 w-full bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none" data-testid={`${testId}-search`} />
          {(query || value.length === 0) && options.length > 0 && (
            <div className="no-scrollbar flex gap-1.5 overflow-x-auto pb-0.5">
              {options.map((c) => (
                <button key={c.id} type="button" onClick={() => { onChange([...value, c.id]); setQ(''); }}
                  className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-border pl-1 pr-3 text-xs font-medium hover:border-primary/50" data-testid={`${testId}-add-${c.id}`}>
                  <CharacterAvatar character={c} size={28} /> @{c.handle}
                </button>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}
