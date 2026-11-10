import { useEffect, useRef, useState } from 'react';
import { Link, useLocation, useParams } from 'wouter';
import { customFetch } from '@workspace/api-client-react';
import { useLanguage } from '@/lib/i18n';
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
import { useCharacterEditorText } from '@/lib/character-editor-translations';
import { BasicFields, type BasicForm } from '@/components/characters/basic-fields';
import { BasicVoiceCatalogue } from '@/components/characters/basic-voice-catalogue';
import { PremiumVoiceStudio } from '@/components/characters/premium-voice-studio';
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
  const t = useCharacterEditorText();
  const language = useLanguage();
  const [voiceEntitlements, setVoiceEntitlements] = useState<{basicVoices:boolean;customVoices:boolean}|null>(null);
  useEffect(() => {
    let active = true;
    void customFetch<{features:{basicVoices:boolean;customVoices:boolean}}>('/api/account/entitlements',{responseType:'json'})
      .then(data => { if(active) setVoiceEntitlements(data.features); })
      .catch(() => { if(active) setVoiceEntitlements(null); });
    return () => { active = false; };
  }, []);
  const voiceLabel = (kind:'basic'|'premium') => {
    const labels: Record<string,[string,string]> = {
      es:['Voces · Selección predeterminada','Voces · Voice Studio Premium'],
      en:['Voices · Preset selection','Voices · Premium Voice Studio'],
      pt:['Vozes · Seleção predefinida','Vozes · Estúdio Premium'],
      fr:['Voix · Sélection prédéfinie','Voix · Studio Premium'],
      de:['Stimmen · Voreinstellungen','Stimmen · Premium-Studio'],
      it:['Voci · Selezione predefinita','Voci · Studio Premium'],
      ko:['음성 · 기본 목소리 선택','음성 · 프리미엄 스튜디오'],
      ja:['声 · プリセット選択','声 · プレミアムスタジオ'],
      zh:['声音 · 预设选择','声音 · 高级工作室']
    };
    return (labels[language]??labels.en)[kind==='basic'?0:1];
  };
  const params = useParams<{ id?: string }>();
  const isNew = !params.id || params.id === 'new';
  const { state, character, actions } = useSocial();
  const [, navigate] = useLocation();
  const back = useBack();
  const account = isNew ? undefined : character(params.id!);
  const sharedPrimary = account?.personId && account.personId !== account.id ? character(account.personId) : undefined;

  const [mode, setMode] = useState<Mode>(isNew ? 'quick' : 'advanced');
  const [linkedSourceId, setLinkedSourceId] = useState('');
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

  if (!isNew && !account) return (<><TopBar title={t("Personaje")} onBack={back} /><EmptyState title={t("No encontramos este personaje")} body={t("Puede que se haya eliminado.")} /></>);

  const save = () => {
    if (busy || uploading) return;
    setBusy(true); setError(null);
    try {
      const savingConfig = structuredClone(config);
      if (isNew && !savingConfig.basic.name.trim()) savingConfig.basic.name = form.name.trim();
      validateCharacterConfig(savingConfig, state, account?.id);
      const base = account ? accountFormValues(account) : accountFormValues({ ...form, accountType: 'personal' });
      const input: AccountInput = { ...base, name: form.name, handle: form.handle.toLowerCase(), bio: form.bio, avatar: form.avatar, occupation: form.occupation, location: form.location, configuration: savingConfig, identity: identity ?? EMPTY_IDENTITY };
      if (account) {
        actions.updateAccount(account.id, input, original.current);
        original.current = structuredClone(input);
        setDirty(false);
        toast({ title: t('Personaje guardado') });
      } else {
        const id = linkedSourceId ? actions.createLinkedAccount(linkedSourceId, input) : actions.createAccount(input);
        setDirty(false);
        toast({ title: `@${input.handle} creado`, description: t('Podés seguir completando su ficha.') });
        navigate(`/characters/${id}/edit`, { replace: true });
      }
    } catch (e) {
      setError(e instanceof Error ? e.message : t('No se pudo guardar. Tus cambios siguen acá.'));
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
      <TopBar title={isNew ? t('Nuevo personaje') : `${t('Editar')} ${account!.name}`} onBack={back}
        sub={dirty ? <span className="text-primary" data-testid="status-character-dirty">{t("Cambios sin guardar")}</span> : !isNew ? `${done}/7 ${t("secciones configuradas")}` : undefined} />
      <div className="px-4 pb-40 pt-2" data-testid="page-character-editor">
        {isNew && (
          <div className="mb-4 rounded-2xl border border-border bg-card/40 p-4">
            <label htmlFor="linked-character-source" className="mb-2 block text-sm font-semibold">{t('Tipo de creación')}</label>
            <select id="linked-character-source" value={linkedSourceId} onChange={(e) => {
              const id = e.target.value;
              setLinkedSourceId(id);
              const source = state.characters.find(c => c.id === id);
              if (source) {
                setFormRaw({ name: source.name, handle: '', bio: '', avatar: source.avatar, occupation: source.occupation, location: source.location });
                setConfigRaw(characterConfig(source));
                setIdentityRaw(structuredClone(source.identity ?? EMPTY_IDENTITY));
                setMode('quick');
              } else {
                setFormRaw(EMPTY);
                setConfigRaw(defaultCharacterConfig());
                setIdentityRaw(structuredClone(EMPTY_IDENTITY));
              }
              setDirty(true);
            }} className="h-12 w-full rounded-xl border border-border bg-background px-3 text-sm" data-testid="select-linked-character">
              <option value="">{t('Personaje nuevo (identidad independiente)')}</option>
              {state.characters.filter(c => !c.archived && c.accountType !== 'band' && c.accountType !== 'business' && c.accountType !== 'venue' && c.accountType !== 'organization').map(c => (
                <option key={c.id} value={c.id}>{t('Segunda cuenta de')} {c.name} (@{c.handle})</option>
              ))}
            </select>
            {linkedSourceId && <p className="mt-2 text-xs text-muted-foreground">{t('Se reutilizan la personalidad y las referencias del personaje. Elegí un @ nuevo. Los seguidores, publicaciones y privacidad de esta cuenta serán independientes.')}</p>}
          </div>
        )}
        {isNew && (
          <div className="mt-2 flex rounded-2xl bg-secondary p-1" role="tablist" aria-label={t("Modo de creación")}>
            {([['quick', 'Rápido'], ['advanced', 'Avanzado'], ['assisted', 'Asistido']] as const).map(([m, l]) => (
              <button key={m} role="tab" aria-selected={mode === m} onClick={() => setMode(m)} className={cn('h-11 flex-1 rounded-xl text-xs font-semibold', mode === m ? 'bg-card text-foreground' : 'text-muted-foreground')} data-testid={`tab-character-${m}`}>{t(l)}</button>
            ))}
          </div>
        )}

        {sharedPrimary ? <>
          <BasicFields form={form} setForm={setForm} onBusy={setUploading} />
          <p className="mt-4 rounded-xl border border-border p-3 text-xs text-muted-foreground">{t('Esta cuenta usa la personalidad, memoria y referencias visuales del personaje principal. Podés editar aquí el perfil público, sin duplicar su identidad.')}</p>
        </> : mode === 'assisted' ? <AssistedPanel config={config} set={set} onManual={() => setMode('advanced')} /> : <>
          <BasicFields form={form} setForm={setForm} onBusy={setUploading} />
          {voiceEntitlements?.basicVoices && (
            <details className="mt-5 rounded-2xl border border-border bg-card/40" data-testid="character-basic-voices-panel">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>{voiceLabel('basic')}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </summary>
              <div className="border-t border-border px-3 pb-4"><BasicVoiceCatalogue selectedVoiceId={config.voice.basicVoiceId} onSelect={(basicVoiceId) => set((c) => ({ ...c, voice: { ...c.voice, basicVoiceId } }))} /></div>
            </details>
          )}
          {voiceEntitlements?.customVoices && (
            <details className="mt-3 rounded-2xl border border-primary/30 bg-card/40" data-testid="character-premium-voices-panel">
              <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-4 text-sm font-semibold [&::-webkit-details-marker]:hidden">
                <span>{voiceLabel('premium')}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
              </summary>
              <div className="border-t border-border px-3 pb-4"><PremiumVoiceStudio characterId={account?.id} /></div>
            </details>
          )}
          <VisualIdentity avatar={form.avatar} identity={identity} onBusy={setUploading}
            onChange={(next) => { setIdentityRaw(next); setDirty(true); }} />
          {mode === 'quick' && <>
            <div className="grid grid-cols-2 gap-3">
              <NumberInput id="character-quick-age" label={t("Edad (opcional)")} value={config.basic.age} onChange={(age) => set((c) => ({ ...c, basic: { ...c.basic, age } }))} min={0} max={150} />
              <Text id="character-quick-pronouns" label={t("Pronombres (opcional)")} value={config.basic.pronouns} onChange={(pronouns) => set((c) => ({ ...c, basic: { ...c.basic, pronouns } }))} max={100} />
            </div>
            <Area id="character-quick-description" label={t("Descripción (opcional)")} value={config.personality.description} onChange={(description) => set((c) => ({ ...c, personality: { ...c.personality, description } }))} max={24000} rows={5} />
            <p className="mt-3 px-1 text-xs text-muted-foreground">{t("El resto queda con valores por defecto. Podés completarlo después en modo avanzado.")}</p>
          </>}
          {mode === 'advanced' && (
            <div className="mt-8">
              <nav className="no-scrollbar -mx-4 flex gap-1.5 overflow-x-auto px-4 pb-2" aria-label={t("Secciones")}>
                {SECTIONS.map(([k, l]) => (
                  <button key={k} onClick={() => { setOpen(k); document.getElementById(`acc-${k}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' }); }}
                    className={cn('relative flex h-11 shrink-0 items-center gap-1.5 rounded-full border px-3.5 text-xs font-semibold', open === k ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')} data-testid={`chip-section-${k}`}>
                    <span className={cn('h-1.5 w-1.5 rounded-full', status[k] ? 'bg-primary' : 'bg-muted-foreground/40')} aria-hidden />{t(l)}
                    <span className="sr-only">{status[k] ? t(' (configurada)') : t(' (sin configurar)')}</span>
                  </button>
                ))}
              </nav>
              {SECTIONS.map(([k, l]) => (
                <div key={k} id={`acc-${k}`} className="mt-2 scroll-mt-20 rounded-2xl border border-border bg-card/40">
                  <button onClick={() => setOpen(open === k ? null : k)} aria-expanded={open === k} className="flex min-h-14 w-full items-center gap-3 px-4 text-left" data-testid={`button-section-${k}`}>
                    <span className="flex-1 font-display text-[16px] tracking-wide">{t(l)}</span>
                    <span className={cn('text-[11px]', status[k] ? 'text-primary' : 'text-muted-foreground')} data-testid={`status-section-${k}`}>{status[k] ? t('Configurada') : t('Por defecto')}</span>
                    <ChevronDown className={cn('h-4 w-4 transition-transform', open === k && 'rotate-180')} />
                  </button>
                  {open === k && <div className="px-4 pb-5">{renderSection(k)}</div>}
                </div>
              ))}
            </div>
          )}
        </>}

        {sharedPrimary && (
          <div className="mt-5 rounded-2xl border border-border bg-card/40 p-4 text-sm">
            <p className="font-semibold">{t('Cuenta vinculada a')} {sharedPrimary.name} (@{sharedPrimary.handle})</p>
            <p className="mt-2 text-xs text-muted-foreground">{t('La personalidad y los recuerdos pertenecen a la identidad principal. Las publicaciones, galerías y seguidores de esta cuenta son independientes.')}</p>
            <Link href={`/characters/${sharedPrimary.id}/edit`} className="mt-3 inline-block text-sm font-semibold text-primary underline">{t('Editar identidad compartida')}</Link>
          </div>
        )}
        {account && (
          <button onClick={() => setProfileOpen(true)} className="tap mt-8 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm" data-testid="button-open-profile-controls">
            <BadgeCheck className="h-4 w-4" /> {t("Verificación y cifras visibles")}
          </button>
        )}
        {account && <AccountActions account={account} dirty={dirty} />}
        {account && <Link href={`/profile/${account.id}`} className="mt-4 grid h-11 place-items-center text-sm text-muted-foreground underline" data-testid="link-character-profile">{t("Ver perfil")}</Link>}
      </div>

      {(isNew || dirty || busy || uploading || error) && <div className="fixed inset-x-0 bottom-[calc(var(--nav-clearance)-0.5rem)] z-40 mx-auto max-w-[560px] px-4 pb-2 lg:bottom-4 lg:left-[248px] xl:right-[300px]">
        {error && <p role="alert" className="mb-2 rounded-xl bg-destructive/15 p-3 text-sm text-destructive" data-testid="text-character-error">{error}</p>}
        <button onClick={save} disabled={busy || uploading || (!isNew && !dirty)} className="h-12 w-full rounded-2xl bg-primary text-sm font-semibold text-primary-foreground shadow-lg disabled:opacity-60" data-testid="button-character-save">
          {t(uploading ? 'Esperando foto…' : busy ? 'Guardando…' : isNew ? 'Crear personaje' : dirty ? 'Guardar cambios' : 'Todo guardado')}
        </button>
      </div>}
      {account && <AccountEditor open={profileOpen} accountId={account.id} onClose={() => setProfileOpen(false)} />}
    </>
  );
}
