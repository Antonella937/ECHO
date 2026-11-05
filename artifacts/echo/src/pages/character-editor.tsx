import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { BadgeCheck, ChevronDown } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { AccountEditor } from '@/components/echo/account-editor';
import { EmptyState } from '@/components/echo/skeletons';
import { accountFormValues, type AccountInput } from '@/domain/accounts';
import { characterConfig, defaultCharacterConfig, sectionStatus, validateCharacterConfig, type CharacterConfig } from '@/domain/character-core';
import type { Character } from '@/domain/types';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import { BasicFields, type BasicForm } from '@/components/characters/basic-fields';
import { VisualIdentity } from '@/components/characters/visual-identity';
import type { IdentityReference } from '@/domain/types';
import { IdentitySection } from '@/components/characters/identity-section';
import { PersonalitySection } from '@/components/characters/personality-section';
import { RelationshipsSection } from '@/components/characters/relationships-section';
import { RoutineSection } from '@/components/characters/routine-section';
import { SocialSection } from '@/components/characters/social-section';
import { MemorySection } from '@/components/characters/memory-section';
import { StateSection } from '@/components/characters/state-section';
import { AssistedPanel } from '@/components/characters/assisted-panel';
import { AccountActions } from '@/components/characters/account-actions';
import { Area, NumberInput, Text, type SetCfg } from '@/components/characters/ui';

type Mode = 'quick' | 'advanced' | 'assisted';
const SECTIONS = [
  ['identity', 'Identidad'], ['personality', 'Personalidad'], ['relationships', 'Relaciones'], ['routine', 'Rutina'],
  ['social', 'Comportamiento social'], ['memory', 'Memoria'], ['state', 'Estado actual'],
] as const;
type SectionKey = typeof SECTIONS[number][0];
const EMPTY_IDENTITY: IdentityReference = { provider: 'mock', referenceImages: [], seed: 0, appearance: '', styleNotes: '', updatedAt: new Date(0).toISOString() };
const EMPTY: BasicForm = { name: '', handle: '', bio: '', avatar: 'asset:account-default', occupation: '', location: '' };

export default function CharacterEditorPage() {
  const params = useParams<{ id?: string }>();
  const isNew = !params.id || params.id === 'new';
  const { state, character, actions } = useSocial();
  const [, navigate] = useLocation();
  const back = useBack();
  const account = isNew ? undefined : character(params.id!);

  const [mode, setMode] = useState<Mode>(isNew ? 'quick' : 'advanced');
  const [open, setOpen] = useState<SectionKey | null>('identity');
  const [form, setFormRaw] = useState<BasicForm>(EMPTY);
  const [identity, setIdentityRaw] = useState<IdentityReference>(EMPTY_IDENTITY);
  const [config, setConfigRaw] = useState<CharacterConfig>(() => defaultCharacterConfig());
  const [dirty, setDirty] = useState(false);
  const [uploading, setUploading] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [profileOpen, setProfileOpen] = useState(false);
  const original = useRef<AccountInput | undefined>(undefined);
  const initFor = useRef<string | null>(null);

  // Capture once per route/account. Remote updates never reset a draft.
  const key = isNew ? 'new' : params.id!;
  useEffect(() => {
    if (initFor.current === key) return;
    if (!isNew && !account) return;
    initFor.current = key;
    if (account) {
      const cfg = characterConfig(account);
      original.current = { ...accountFormValues(account), occupation: account.occupation, location: account.location, configuration: structuredClone(cfg) };
      setFormRaw({ name: account.name, handle: account.handle, bio: account.bio, avatar: account.avatar, occupation: account.occupation, location: account.location });
      setConfigRaw(cfg);
      setIdentityRaw(structuredClone(account.identity ?? EMPTY_IDENTITY));
    } else {
      original.current = undefined;
      setFormRaw(EMPTY);
      setConfigRaw(defaultCharacterConfig());
      setIdentityRaw(structuredClone(EMPTY_IDENTITY));
    }
    setDirty(false); setError(null); setMode(isNew ? 'quick' : 'advanced');
  }, [key, isNew, account]);

  const setForm = (fn: (p: BasicForm) => BasicForm) => { setFormRaw(fn); setDirty(true); };
  const set: SetCfg = (fn) => { setConfigRaw(fn); setDirty(true); };

  if (!isNew && !account) return (<><TopBar title="Personaje" onBack={back} /><EmptyState title="No encontramos este personaje" body="Puede que se haya eliminado." /></>);

  const save = () => {
    if (busy || uploading) return;
    setBusy(true); setError(null);
    try {
      const savingConfig = structuredClone(config);
      if (isNew && !savingConfig.basic.name.trim()) savingConfig.basic.name = form.name.trim();
      validateCharacterConfig(savingConfig, state, account?.id);
      const base = account ? accountFormValues(account) : accountFormValues({ ...form, accountType: 'personal' });
      const input: AccountInput = { ...base, name: form.name, handle: form.handle.toLowerCase(), bio: form.bio, avatar: form.avatar, occupation: form.occupation, location: form.location, configuration: savingConfig, identity };
      if (account) {
        actions.updateAccount(account.id, input, original.current);
        original.current = structuredClone(input);
        setDirty(false);
        toast({ title: 'Personaje guardado' });
      } else {
        const id = actions.createAccount(input);
        setDirty(false);
        toast({ title: `@${input.handle} creado`, description: 'Podés seguir completando su ficha.' });
        navigate(`/characters/${id}/edit`, { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar. Tus cambios siguen acá.');
    } finally { setBusy(false); }
  };

  const draft = { ...(account ?? {}), ...form } as Character;
  const status = sectionStatus(draft, config);
  const done = SECTIONS.filter(([k]) => status[k]).length;

  const renderSection = (k: SectionKey) => {
    const p = { config, set };
    switch (k) {
      case 'identity': return <IdentitySection {...p} />;
      case 'personality': return <PersonalitySection {...p} />;
      case 'relationships': return <RelationshipsSection {...p} selfId={account?.id} />;
      case 'routine': return <RoutineSection {...p} />;
      case 'social': return <SocialSection {...p} />;
      case 'memory': return <MemorySection {...p} selfId={account?.id} />;
      case 'state': return <StateSection {...p} selfId={account?.id} />;
    }
  };

  return (
    <>
      <TopBar title={isNew ? 'Nuevo personaje' : `Editar ${account!.name}`} onBack={back}
        sub={dirty ? <span className="text-primary" data-testid="status-character-dirty">Cambios sin guardar</span> : !isNew ? `${done}/7 secciones configuradas` : undefined} />
      <div className="px-4 pb-40 pt-2" data-testid="page-character-editor">
        {isNew && (
          <div className="mt-2 flex rounded-2xl bg-secondary p-1" role="tablist" aria-label="Modo de creación">
            {([['quick', 'Rápido'], ['advanced', 'Avanzado'], ['assisted', 'Asistido']] as const).map(([m, l]) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn('h-11 flex-1 rounded-xl text-xs font-semibold', mode === m ? 'bg-card text-foreground' : 'text-muted-foreground')} data-testid={`tab-character-${m}`}>{l}</button>
            ))}
          </div>
        )}

        {mode === 'assisted' ? <AssistedPanel config={config} set={set} onManual={() => setMode('advanced')} /> : <>
          <BasicFields form={form} setForm={setForm} onBusy={setUploading} />
          <VisualIdentity avatar={form.avatar} identity={identity} onBusy={setUploading}
            onChange={(next) => { setIdentityRaw(next); setDirty(true); }} />
          {mode === 'quick' && <>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput id="character-quick-age" label="Edad (opcional)" value={config.basic.age} onChange={(age) => set((c) => ({ ...c, basic: { ...c.basic, age } }))} min={0} max={150} />
              <Text id="character-quick-pronouns" label="Pronombres (opcional)" value={config.basic.pronouns} onChange={(pronouns) => set((c) => ({ ...c, basic: { ...c.basic, pronouns } }))} max={100} />
            </div>
            <Area id="character-quick-description" label="Descripción (opcional)" value={config.personality.description} onChange={(description) => set((c) => ({ ...c, personality: { ...c.personality, description } }))} max={24000} rows={5} />
            <p className="mt-3 px-1 text-xs text-muted-foreground">El resto queda con valores por defecto. Podés completarlo después en modo avanzado.</p>
          </>}
          {mode === 'advanced' && (
            <div className="mt-8">
              <nav className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" aria-label="Secciones">
                {SECTIONS.map(([k, l]) => (
                  <button key={k} onClick={() => { setOpen(k); document.getElementById(`acc-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                    className={cn('relative flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold', open === k ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')} data-testid={`chip-section-${k}`}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', status[k] ? 'bg-primary' : 'bg-muted-foreground/40')} aria-hidden />{l}
                    <span className="sr-only">{status[k] ? ' (configurada)' : ' (sin configurar)'}</span>
                  </button>
                ))}
              </nav>
              {SECTIONS.map(([k, l]) => (
                <div key={k} id={`acc-${k}`} className="mt-2 scroll-mt-20 rounded-2xl border border-border bg-card/40">
                  <button onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} className="flex min-h-14 w-full items-center gap-3 px-4 text-left" data-testid={`button-section-${k}`}>
                    <span className="flex-1 font-display text-[16px] tracking-wide">{l}</span>
                    <span className={cn('text-[11px]', status[k] ? 'text-primary' : 'text-muted-foreground')} data-testid={`status-section-${k}`}>{status[k] ? 'Configurada' : 'Por defecto'}</span>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', open === k && 'rotate-180')} />
                  </button>
                  {open === k && <div className="px-4 pb-5">{renderSection(k)}</div>}
                </div>
              ))}
            </div>
          )}
        </>}

        {account && (
          <button onClick={() => setProfileOpen(true)} className="tap mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm" data-testid="button-open-profile-controls">
            <BadgeCheck className="h-4 w-4" /> Verificación y cifras visibles
          </button>
        )}
        {account && <AccountActions account={account} dirty={dirty} />}
        {account && <Link href={`/profile/${account.id}`} className="mt-4 grid h-11 place-items-center text-sm text-muted-foreground underline" data-testid="link-character-profile">Ver perfil</Link>}
      </div>

      {(isNew || dirty || busy || uploading || error) && <div className="fixed inset-x-0 bottom-[calc(var(--nav-clearance)-0.5rem)] z-40 mx-auto max-w-[560px] px-4 pb-2 lg:bottom-4 lg:left-[248px] xl:right-[300px]">
        {error && <p role="alert" className="mb-2 rounded-xl bg-destructive/15 p-3 text-sm text-destructive" data-testid="text-character-error">{error}</p>}
        <button onClick={save} disabled={busy || uploading || (!isNew && !dirty)} className="h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-lg disabled:opacity-60" data-testid="button-character-save">
          {uploading ? 'Esperando foto…' : busy ? 'Guardando…' : isNew ? 'Crear personaje' : dirty ? 'Guardar cambios' : 'Todo guardado'}
        </button>
      </div>}
      {account && <AccountEditor open={profileOpen} accountId={account.id} onClose={() => setProfileOpen(false)} />}
    </>
  );
}
