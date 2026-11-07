import { useAccountManagementText } from '@/lib/account-management-translations';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Check, Pencil, Plus, SlidersHorizontal, Images } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { VerifiedBadge } from './verified-badge';
import { AccountEditor } from './account-editor';
import { accountTypes } from '@/domain/accounts';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

/** Identity switcher + account management (active / archived). */
export function AccountManager() {
  const translate = useAccountManagementText();
  const { state, me, actions } = useSocial();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const list = state.characters.filter((c) => (tab === 'archived' ? c.archived : !c.archived));
  const archivedCount = state.characters.filter((c) => c.archived).length;

  return (
    <div>
      <div className="mt-3 flex items-center gap-2">
        <div className="flex flex-1 rounded-2xl bg-secondary p-1" role="tablist">
          {(['active', 'archived'] as const).map((t) => (
            <button key={t} role="tab" aria-selected={tab === t} onClick={() => setTab(t)}
              className={cn('h-10 flex-1 rounded-xl text-xs font-semibold transition-colors', tab === t ? 'bg-card text-foreground' : 'text-muted-foreground')}
              data-testid={`tab-accounts-${t}`}>
              {t === 'active' ? translate('Activas') : `${translate('Archivadas')}${archivedCount ? ` · ${archivedCount}` : ''}`}
            </button>
          ))}
        </div>
      </div>
      <Link href="/characters/new" className="mt-3 flex h-12 items-center justify-center gap-2 rounded-2xl bg-primary px-4 text-sm font-semibold text-primary-foreground" data-testid="button-create-character">
        <Plus className="h-4 w-4" /> {translate('Crear personaje')}
      </Link>

      <div className="mt-3 flex flex-col gap-2" role={tab === 'active' ? 'radiogroup' : undefined} aria-label={translate("Identidad activa")}>
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="text-accounts-empty">
            {tab === 'archived' ? translate('No hay cuentas archivadas. Todo sigue a la vista.') : translate('Sin cuentas activas.')}
          </p>
        )}
        {list.map((c) => {
          const active = c.id === me.id;
          return (
            <div key={c.id} className={cn('flex items-center gap-2 rounded-2xl border p-2 pr-1.5', active ? 'border-primary/50 bg-accent/40' : 'border-border')} data-testid={`row-account-${c.id}`}>
              <button
                role={tab === 'active' ? 'radio' : undefined}
                aria-checked={tab === 'active' ? active : undefined}
                disabled={c.archived}
                onClick={() => {
                  if (active || c.archived) return;
                  actions.switchIdentity(c.id);
                  toast({ title: `${translate('Ahora publicas como ')}${c.name}` });
                  // Switching identity opens that character's profile; editing remains a separate action.
                  navigate(`/profile/${c.id}`, { replace: true });
                }}
                className="flex min-w-0 flex-1 items-center gap-3 p-1 text-left"
                data-testid={`radio-identity-${c.id}`}
              >
                <CharacterAvatar character={c} size={44} className={c.archived ? 'opacity-50' : undefined} />
                <div className="min-w-0 flex-1">
                  <div className="flex items-center gap-1 text-sm font-semibold"><span className="truncate">{c.name}</span><VerifiedBadge account={c} /></div>
                  <div className="truncate text-xs text-muted-foreground">@{c.handle} · {translate(accountTypes[c.accountType ?? 'personal'])}</div>
                </div>
                {tab === 'active' && (
                  <span className={cn('grid h-6 w-6 shrink-0 place-items-center rounded-full border', active ? 'border-primary bg-primary text-primary-foreground' : 'border-[hsl(240_4%_26%)]')}>
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                )}
              </button>
              {!c.archived && <Link href={`/characters/${c.id}/gallery`} aria-label={`Galería de ${c.name}`} title="Galería del personaje" className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"><Images className="h-4 w-4" strokeWidth={1.8}/></Link>}
              <Link href={`/characters/${c.id}/edit`} aria-label={`${translate('Ficha de personaje de ')}${c.name}`} className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid={`link-character-edit-${c.id}`}>
                <SlidersHorizontal className="h-4 w-4" strokeWidth={1.8} />
              </Link>
              <button onClick={() => setEditing(c.id)} aria-label={`${translate('Editar ')}${c.name}`} className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground" data-testid={`button-edit-account-${c.id}`}>
                <Pencil className="h-4 w-4" strokeWidth={1.8} />
              </button>
            </div>
          );
        })}
      </div>

      <AccountEditor open={editing !== undefined} accountId={editing} onClose={() => setEditing(undefined)} />
    </div>
  );
}
