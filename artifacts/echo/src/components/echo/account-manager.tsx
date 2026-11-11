import { useAccountManagementText } from '@/lib/account-management-translations';
import { useLanguage } from '@/lib/i18n';
import { galleryLabels } from '@/lib/gallery-translations';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { Check, MoreHorizontal, Pencil, Plus, SlidersHorizontal, Images, Star } from 'lucide-react';
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
  const language = useLanguage();
  const galleryLabel = galleryLabels[language].title;
  const primaryLabels: Record<string, [string,string,string]> = {
    es:['Personaje principal','Marcar como personaje principal','Los personajes autónomos priorizan esta cuenta'],
    en:['Main character','Set as main character','Autonomous characters prioritize this account'],
    pt:['Personagem principal','Definir como personagem principal','Personagens autônomos priorizam esta conta'],
    fr:['Personnage principal','Définir comme personnage principal','Les personnages autonomes privilégient ce compte'],
    de:['Hauptfigur','Als Hauptfigur festlegen','Autonome Figuren bevorzugen dieses Konto'],
    it:['Personaggio principale','Imposta come personaggio principale','I personaggi autonomi danno priorità a questo account'],
    ko:['대표 캐릭터','대표 캐릭터로 설정','자율 캐릭터가 이 계정을 우선합니다'],
    ja:['メインキャラクター','メインキャラクターに設定','自律キャラクターがこのアカウントを優先します'],
    zh:['主角色','设为主角色','自主角色优先与此账号互动'],
  };
  const primaryText = primaryLabels[language] ?? primaryLabels.en;
  const { state, me, actions } = useSocial();
  const [, navigate] = useLocation();
  const [tab, setTab] = useState<'active' | 'archived'>('active');
  const [editing, setEditing] = useState<string | null | undefined>(undefined);
  const [professionalCreation, setProfessionalCreation] = useState(false);
  const [openActionsId, setOpenActionsId] = useState<string | null>(null);
  const list = state.characters.filter((c) => (tab === 'archived' ? c.archived : !c.archived));
  const archivedCount = state.characters.filter((c) => c.archived).length;
  const primaryId = state.primaryCharacterId ?? state.currentCharacterId;
  const groups = [
    { id: 'people', label: language === 'es' ? 'Personajes y personas' : 'Characters & people', accounts: list.filter(c => !c.accountType || c.accountType === 'personal') },
    { id: 'professional', label: language === 'es' ? 'Proyectos y cuentas profesionales' : 'Projects & professional accounts', accounts: list.filter(c => c.accountType && c.accountType !== 'personal') },
  ].filter(group => group.accounts.length > 0);

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
      {tab === 'active' && <p className="mt-3 text-xs text-muted-foreground">{primaryText[2]}</p>}
      <div className="mt-3 grid grid-cols-2 gap-2">
        <Link href="/characters/new" className="flex min-h-12 items-center justify-center gap-1 rounded-2xl bg-primary px-2 py-3 text-center text-xs font-semibold text-primary-foreground sm:text-sm" data-testid="button-create-character">
          <Plus className="h-4 w-4 shrink-0" /> {translate('Crear personaje')}
        </Link>
        <button type="button" onClick={() => { setProfessionalCreation(true); setEditing(null); }} className="flex min-h-12 items-center justify-center gap-1 rounded-2xl bg-primary px-2 py-3 text-center text-xs font-semibold text-primary-foreground sm:text-sm" data-testid="button-create-professional-account">
          <Plus className="h-4 w-4 shrink-0" /> {language === 'es' ? 'Cuenta profesional' : 'Professional account'}
        </button>
      </div>

      <div className="mt-3 flex flex-col gap-2" role={tab === 'active' ? 'radiogroup' : undefined} aria-label={translate("Identidad activa")}>
        {list.length === 0 && (
          <p className="rounded-2xl border border-dashed border-border p-6 text-center text-sm text-muted-foreground" data-testid="text-accounts-empty">
            {tab === 'archived' ? translate('No hay cuentas archivadas. Todo sigue a la vista.') : translate('Sin cuentas activas.')}
          </p>
        )}
        {groups.map(group => <div key={group.id} className="space-y-2"><div className="flex items-center justify-between px-1 pt-2"><h3 className="text-[11px] font-semibold uppercase tracking-[0.14em] text-muted-foreground">{group.label}</h3><span className="text-xs text-muted-foreground">{group.accounts.length}</span></div>{group.accounts.map((c) => {
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
              <div className="relative shrink-0">
                <button type="button" aria-label={language === 'es' ? `Opciones de ${c.name}` : `Options for ${c.name}`}
                  aria-expanded={openActionsId === c.id} aria-haspopup="menu"
                  onClick={() => setOpenActionsId(current => current === c.id ? null : c.id)}
                  className="tap grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                  data-testid={`button-account-actions-${c.id}`}>
                  <MoreHorizontal className="h-5 w-5" />
                </button>
                {openActionsId === c.id && (
                  <div role="menu" aria-label={language === 'es' ? `Opciones de ${c.name}` : `Options for ${c.name}`}
                    className="absolute right-0 top-full z-50 mt-1 w-60 max-w-[calc(100vw-64px)] overflow-hidden rounded-xl border border-border bg-card p-1.5 text-sm shadow-xl">
                    {!c.archived && <button type="button" role="menuitem" onClick={() => {
                      if (primaryId !== c.id) {
                        actions.setPrimaryIdentity(c.id);
                        toast({ title: primaryText[0] + ': ' + c.name });
                      }
                      setOpenActionsId(null);
                    }} className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-secondary">
                      <Star className="h-4 w-4 shrink-0" fill={primaryId === c.id ? 'currentColor' : 'none'} />
                      <span>{primaryId === c.id ? primaryText[0] : primaryText[1]}</span>
                    </button>}
                    {!c.archived && <Link role="menuitem" href={`/characters/${c.id}/gallery`} onClick={() => setOpenActionsId(null)}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-secondary">
                      <Images className="h-4 w-4 shrink-0" /><span>{galleryLabel}</span>
                    </Link>}
                    <Link role="menuitem" href={`/characters/${c.id}/edit`} onClick={() => setOpenActionsId(null)}
                      className="flex min-h-11 items-center gap-3 rounded-lg px-3 hover:bg-secondary"
                      data-testid={`link-character-edit-${c.id}`}>
                      <SlidersHorizontal className="h-4 w-4 shrink-0" /><span>{translate('Ficha de personaje de ')}{c.name}</span>
                    </Link>
                    <button type="button" role="menuitem" onClick={() => { setEditing(c.id); setOpenActionsId(null); }}
                      className="flex min-h-11 w-full items-center gap-3 rounded-lg px-3 text-left hover:bg-secondary"
                      data-testid={`button-edit-account-${c.id}`}>
                      <Pencil className="h-4 w-4 shrink-0" /><span>{translate('Editar ')}{c.name}</span>
                    </button>
                  </div>
                )}
              </div>
            </div>
          );
        })}</div>)}
      </div>

      <AccountEditor open={editing !== undefined || professionalCreation} accountId={professionalCreation ? null : editing} initialType={professionalCreation ? "band" : "personal"} onClose={() => { setEditing(undefined); setProfessionalCreation(false); }} />
    </div>
  );
}
