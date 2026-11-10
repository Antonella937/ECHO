import { useCreatorPreviewText } from '@/lib/creator-preview-translations';
import {
  ArrowLeft,
  ArrowRight,
  AudioLines,
  Check,
  ChevronRight,
  CircleHelp,
  Eye,
  Image,
  LockKeyhole,
  MessageCircle,
  Plus,
  Shield,
  Sparkles,
  UsersRound,
  Video,
  WandSparkles,
} from 'lucide-react';
import { Link } from 'wouter';
import React, { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { PublicLanguageSelector } from '@/components/echo/public-language-selector';
import { UniverseCover } from '../components/echo/visual-defaults';
import { PrivateShareCards } from '../components/echo/private-share-cards';
import { hasCharacterImage, ownerScopedPreviewKey } from '../lib/visual-defaults';
import { useMediaResolver } from '../lib/media';
import { useUser } from '@clerk/react';
import {
  getGetCreatorAccountQueryKey,
  getGetUniverseQueryKey,
  getListCreatorUniversesQueryKey,
  useCreateCreatorUniverse,
  useGetCreatorAccount,
  useGetUniverse,
  useListCreatorUniverses,
} from '@workspace/api-client-react';
import { PublicFooter, PublicHeader } from './landing';
import { createStarterUniverse } from '@/store/create-starter-universe';
import { getActiveUniverseId, setActiveUniverseId } from '@/store/persistence';
import { useLocation } from 'wouter';
import './creator-product-previews.css';

export function PreviewShell({ children }: { children: React.ReactNode }) {
  const { isLoaded, isSignedIn } = useUser();
  const authenticated = isLoaded && isSignedIn;
  return (
    <main className="echo-public epc-shell">
      <div className="ep-wrap">
        {authenticated ? <header className="epc-private-nav">
          <button type="button" className="epc-private-back" onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.assign("/settings"); }} aria-label="Volver"><ArrowLeft size={19} /><span>Volver</span></button>
          <Link href="/" className="ep-brand" aria-label="ECHO"><span className="ep-mark" aria-hidden="true"><span>e</span></span><span>ECHO</span></Link>
          <PublicLanguageSelector />
        </header> : <PublicHeader previewMode />}
        {children}
        {!authenticated && <PublicFooter previewMode signature="script" />}
      </div>
    </main>
  );
}

function PreviewNotice({ children }: { children: React.ReactNode }) {
  return (
    <aside className="epc-notice">
      <Eye size={15} aria-hidden="true" />
      <p>{children}</p>
    </aside>
  );
}

export function PreviewHeading({
  eyebrow,
  title,
  accent,
  description,
}: {
  eyebrow: string;
  title: string;
  accent: string;
  description: string;
}) {
  return (
    <section className="epc-heading">
      <span className="ep-eyebrow">{eyebrow}</span>
      <h1 className="ep-serif">{title}<br /><em>{accent}</em></h1>
      <p>{description}</p>
    </section>
  );
}

function OwnerAccountPending({ loading, onRetry }: { loading: boolean; onRetry: () => void }) {
  const t = useCreatorPreviewText();
  return (
    <section className="ep-complete" role={loading ? 'status' : 'alert'} data-testid={loading ? 'status-account-loading' : 'status-account-error'}>
      <span className="ep-eyebrow">{loading ? t("Cargando tu cuenta…") : t("No se pudo cargar tu cuenta")}</span>
      {!loading && <button type="button" className="ep-button" onClick={onRetry} data-testid="button-retry-account">{t("Reintentar")}</button>}
    </section>
  );
}

export function CreatorAccountPreview() {
  const t = useCreatorPreviewText();
  const { isLoaded, isSignedIn, user } = useUser();
  const live = useGetCreatorAccount({ query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: ownerScopedPreviewKey(getGetCreatorAccountQueryKey(), user?.id) } });
  const account = isSignedIn ? live.data : undefined;
  const usage = account?.usage;
  const [lifetimeAccess, setLifetimeAccess] = useState<'owner_lifetime' | 'founder_lifetime' | null>(null);
  useEffect(() => {
    if (!isLoaded || !isSignedIn) return;
    let cancelled = false;
    void customFetch<{ lifetimeAccess?: 'owner_lifetime' | 'founder_lifetime' | null; billingExempt?: boolean }>('/api/account/entitlements', { responseType: 'json' })
      .then((entitlements) => { if (!cancelled) setLifetimeAccess(entitlements.billingExempt ? entitlements.lifetimeAccess ?? null : null); })
      .catch(() => { if (!cancelled) setLifetimeAccess(null); });
    return () => { cancelled = true; };
  }, [isLoaded, isSignedIn]);
  const isCreator = lifetimeAccess === 'owner_lifetime';
  const isFoundingTester = lifetimeAccess === 'founder_lifetime';
  const unlimited = Boolean(account && (account.maxCharacters >= 100000 || account.maxUniverses >= 10000));
  const heading = <PreviewHeading
        eyebrow={t("Cuenta · plan")}
        title={t("Tu espacio, a")}
        accent={t("tu ritmo.")}
        description={t("Consultá tu membresía ECHO y el espacio disponible para crear.")}
      />;
  if (!isLoaded || (isSignedIn && !account)) {
    return <PreviewShell>{heading}<OwnerAccountPending loading={!live.isError} onRetry={() => void live.refetch()} /></PreviewShell>;
  }
  return (
    <PreviewShell>
      {heading}
      {!account && <PreviewNotice>{t("Datos ilustrativos: inicia sesión para ver el plan y el uso reales de tu cuenta.")}</PreviewNotice>}
      <section className="epc-account-layout" aria-label={t("Resumen ilustrativo de cuenta")}>
        <article className="epc-plan-panel">
          <div className="epc-panel-topline"><span>{isCreator ? "ECHO · FOUNDER & CREATOR" : isFoundingTester ? "ECHO · FOUNDING TESTER" : account ? t("TU PLAN") : t("PLAN DE EJEMPLO")}</span><span className="epc-status">{account ? t("Activo · sin cobros") : t("Activo · ilustrativo")}</span></div>
          <div className="epc-plan-name"><span className="epc-plan-monogram">e</span><div><span>{isCreator ? t("Fundadora y creadora de ECHO") : isFoundingTester ? t("Tester fundadora de ECHO") : t("Plan actual")}</span><h2>{isCreator ? "ECHO CREATOR" : isFoundingTester ? "ECHO FOUNDING TESTER" : String(account?.plan ?? 'free').toUpperCase()}</h2></div></div>
          <p className="epc-panel-copy">{isCreator ? t("El universo que creaste. Acceso vitalicio a todas las membresías y complementos, sin cargos de suscripción. ♡") : isFoundingTester ? t("Gracias por acompañar a ECHO desde el principio. Tu acceso de tester fundadora es vitalicio. ♡") : t("Un comienzo para crear un universo privado y darle forma a sus personajes.")}</p>
          <div className="epc-capacity">
            <div><span>{t("Universos")}</span><strong>{account ? `${account.universeCount} / ${unlimited ? '∞' : account.maxUniverses}` : t('1 universo')}</strong></div>
            <div className="epc-capacity-rule" aria-hidden="true"><i /></div>
            <div><span>{t("Personajes")}</span><strong>{account ? `${account.characterCount} / ${unlimited ? '∞' : account.maxCharacters}` : t('Hasta 5 personajes')}</strong></div>
          </div>
          <Link href="/settings/subscriptions" className="ep-button epc-wide-link">{isCreator ? t("Ver mis beneficios de creadora") : isFoundingTester ? t("Ver mis beneficios de tester") : t("Ver planes Free, Plus y Premium")} <ArrowRight size={15} /></Link>
        </article>
        <article className="epc-activity-panel">
          <div className="epc-panel-title"><span className="epc-icon-tile"><Sparkles size={17} /></span><div><span>{t("Herramientas")}</span><h2>{t("Lo que puedes explorar")}</h2></div></div>
          {[
            { key: 'brain_text', label: t("Texto · Brain"), icon: <WandSparkles size={16} /> },
            { key: 'autonomy', label: 'Autonomy', icon: <Sparkles size={16} /> },
            { key: 'memory_context', label: t("Memoria y contexto"), icon: <MessageCircle size={16} /> },
            { key: 'vision', label: 'Vision', icon: <Eye size={16} /> },
            { key: 'images', label: t("Imágenes"), icon: <Image size={16} /> },
          ].map(item => {
            const entry = usage?.categories[item.key as keyof NonNullable<typeof usage>['categories']];
            return <div className="epc-tool-row" key={item.key}>
              <span className="epc-tool-icon">{item.icon}</span>
              <div><strong>{item.label}</strong><small>{account ? `${entry?.calls ?? 0} ${t('operaciones')} · ${entry?.units ?? 0} ${t('unidades internas este mes')}` : t("Consumo mensual por categoría")}</small></div>
              <span className="epc-tool-state">{account ? t("Registrado") : t("Por definir")}</span>
            </div>;
          })}
          <p className="epc-subtle-note">{account
            ? t("El consumo se controla de forma interna; los límites visibles de IA se definirán más adelante.")
            : t("No se muestran límites numéricos de IA hasta calibrarlos con costos reales.")}</p>
        </article>
      </section>
      <div className="epc-account-return">
        <button type="button" className="ep-text-link" onClick={() => { if (window.history.length > 1) window.history.back(); else window.location.assign('/settings'); }}>
          <ArrowLeft size={16} /> {t("Volver")}
        </button>
      </div>
    </PreviewShell>
  );
}

export function CreatorUniversePreview() {
  const t = useCreatorPreviewText();
  const { isLoaded, isSignedIn, user } = useUser();
  const accountQuery = useGetCreatorAccount({ query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: ownerScopedPreviewKey(getGetCreatorAccountQueryKey(), user?.id) } });
  const account = isSignedIn ? accountQuery.data : undefined;
  const media = useMediaResolver();
  const unlimited = Boolean(account && (account.maxCharacters >= 100000 || account.maxUniverses >= 10000));
  const activeUniverseId = user?.id ? getActiveUniverseId(user.id) : 'primary';
  const universesQuery = useListCreatorUniverses({ universeId: activeUniverseId }, {
    query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: ownerScopedPreviewKey(getListCreatorUniversesQueryKey({ universeId: activeUniverseId }), user?.id) },
  });
  const activeUniverseQuery = useGetUniverse({ universeId: activeUniverseId }, {
    query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: ownerScopedPreviewKey(getGetUniverseQueryKey({ universeId: activeUniverseId }), user?.id) },
  });
  const universes = universesQuery.data ?? [];
  const activeUniverse = isSignedIn ? activeUniverseQuery.data?.state ?? null : null;
  const universeMetadata = universes.find(universe => universe.universeId === activeUniverseId);
  const universeName = universeMetadata?.name ?? activeUniverse?.creatorSetup?.universeName ?? (account ? '' : t('Casa de papel'));
  const capacityPercent = account ? (account.maxCharacters >= 100000 ? 0 : Math.min(100, Math.round(100 * account.characterCount / Math.max(1, account.maxCharacters)))) : 60;
  const createUniverse = useCreateCreatorUniverse();
  const [actionError, setActionError] = useState<string | null>(null);
  const [, navigate] = useLocation();
  const atCharacterLimit = Boolean(account && account.characterCount >= account.maxCharacters);
  const createCharacter = () => {
    if (!isSignedIn) return;
    if (atCharacterLimit) { navigate('/creator-preview/limit'); return; }
    navigate('/characters/new');
  };
  const addUniverse = async () => {
    if (!isSignedIn || !user) return;
    if (account && account.universeCount >= account.maxUniverses) { navigate('/creator-preview/limit'); return; }
    const name = window.prompt(t('Nombre del nuevo universo'));
    if (!name?.trim()) return;
    setActionError(null);
    try {
      const plan = account?.plan ?? 'free';
      const ownerCharacter = activeUniverse?.characters.find(
        character => character.id === activeUniverse.currentCharacterId && !character.archived,
      ) ?? activeUniverse?.characters.find(character => !character.archived);
      const displayName = ownerCharacter?.name?.trim() || user.fullName?.trim() || user.username?.trim() || 'Creator';
      const rawHandle = ownerCharacter?.handle || user.username || user.id;
      const username = rawHandle.replace(/^@/, '').toLowerCase().replace(/[^a-z0-9_.-]/g, '') || 'creator';
      const state = createStarterUniverse({
        plan, universeName: name.trim(), displayName, username, bio: ownerCharacter?.bio ?? '',
      });
      const created = await createUniverse.mutateAsync({ data: { name: name.trim(), state } });
      setActiveUniverseId(user.id, created.universeId);
      window.location.assign('/');
    } catch (error) {
      const message = (error as { data?: { error?: string } })?.data?.error ?? (error as Error).message;
      setActionError(message);
      if (message.includes('LIMIT_REACHED')) navigate('/creator-preview/limit');
    }
  };
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow={t("Tu universo · personajes")}
        title={t("Un lugar para")}
        accent={t("cada personaje.")}
        description={account ? t("Tus universos y personajes, con capacidad sincronizada desde tu cuenta.") : t("Una composición de muestra para visualizar cómo se organiza un universo y sus personajes.")}
      />
      {!account && <PreviewNotice>{t("Ilustración con conteos de ejemplo. Inicia sesión para ver y gestionar tus datos.")}</PreviewNotice>}
      <section className="epc-universe-board" aria-label={t("Ilustración de gestión de universo")}>
        <div className="epc-universe-sidebar">
          <div className="epc-universe-cover"><UniverseCover name={universeName} /></div>
          <span className="epc-overline">{account ? t("TU UNIVERSO ACTIVO") : t("UNIVERSO DE EJEMPLO")}</span>
          <h2>{universeName || t('Mi universo')}</h2>
          <p>{t("Un espacio privado para reunir personajes, ideas y conversaciones.")}</p>
          <div className="epc-universe-stats">
            <div><span>{t("Universos usados")}</span><strong>{account ? `${account.universeCount} ` : '1 '}<small>/ {unlimited ? '∞' : account?.maxUniverses ?? 1}</small></strong></div>
            <div><span>{t("Personajes usados")}</span><strong>{account ? `${account.characterCount} ` : '3 '}<small>/ {unlimited ? '∞' : account?.maxCharacters ?? 5}</small></strong></div>
          </div>
          <div className="epc-slot-label"><span>{account ? t("Capacidad de personajes") : t("Capacidad de ejemplo")}</span><span>{account ? `${account.characterCount} ${t('de')} ${unlimited ? '∞' : account.maxCharacters}` : `3 ${t('de')} 5`}</span></div>
          <div className="epc-capacity-track" role="progressbar" aria-label={t("Capacidad de personajes")} aria-valuemin={0} aria-valuemax={unlimited ? undefined : account?.maxCharacters ?? 5} aria-valuenow={account?.characterCount ?? 3}>
            <span style={{ width: `${capacityPercent}%` }} />
          </div>
          {account && <button type="button" className="epc-caption" onClick={() => void addUniverse()} disabled={createUniverse.isPending}>
            {createUniverse.isPending ? t("Creando…") : account.universeCount >= account.maxUniverses ? t("Cupo de universos alcanzado") : t("Añadir universo")}
          </button>}
          {!account && <small className="epc-caption">{t("Muestra conceptual de Free")}</small>}
        </div>
        <div className="epc-characters-area">
          <div className="epc-characters-head"><div><span className="ep-overline">{t("COLECCIÓN")}</span><h2>{t("Personajes")}</h2></div>{!account && <span className="epc-example-tag">{t("EJEMPLO")}</span>}</div>
          <div className="epc-character-list">
            {account && activeUniverse ? activeUniverse.characters.filter(character => !character.archived).map(character => (
              <Link href={`/profile/${character.id}`} className="epc-character-row" key={character.id} data-testid={`link-creator-character-${character.id}`}>
                {hasCharacterImage(character.avatar) ? <img className="epc-character-avatar epc-character-photo" alt="" src={media(character.avatar, { sourceUniverseId: activeUniverseId, sourceCharacterId: character.id, sourceType: "avatar", sourceContentId: character.id })} /> : <span className="epc-character-avatar rose" aria-hidden="true">{character.name.trim().charAt(0).toUpperCase() || 'E'}</span>}
                <span className="epc-character-name">{character.name}<small>@{character.handle}</small></span>
                <ChevronRight size={16} aria-hidden="true" />
              </Link>
            )) : [
              { monogram: 'A', label: t("Personaje de muestra A"), tint: 'rose' },
              { monogram: 'B', label: t("Personaje de muestra B"), tint: 'lilac' },
              { monogram: 'C', label: t("Personaje de muestra C"), tint: 'sand' },
            ].map(character => (
              <div className="epc-character-row" key={character.monogram}>
                <span className={`epc-character-avatar ${character.tint}`} aria-hidden="true">{character.monogram}</span>
                <span className="epc-character-name">{character.label}<small>{t("Perfil privado · muestra")}</small></span>
                <ChevronRight size={16} aria-hidden="true" />
              </div>
            ))}
          </div>
          <button className="epc-add-character" type="button" disabled={!account} onClick={createCharacter} aria-label={t("Añadir personaje")}>
            <span><Plus size={16} /></span><strong>{t("Añadir personaje")}</strong><small>{account ? atCharacterLimit ? t('Límite alcanzado') : t('En este universo') : t('Acción ilustrativa')}</small>
          </button>
          {actionError && <p role="alert" className="epc-subtle-note">{actionError}</p>}
          {account && universes.length > 1 && <div className="epc-character-list" aria-label={t("Tus universos")}>
            {universes.map(universe => <button key={universe.universeId} type="button" className="epc-character-row w-full text-left"
              onClick={() => {
                if (user && universe.universeId !== activeUniverseId) {
                  setActiveUniverseId(user.id, universe.universeId);
                  window.location.assign('/');
                }
              }}>
              <span className="epc-character-avatar lilac" aria-hidden="true">e</span>
              <span className="epc-character-name">{universe.name}<small>{universe.characterCount} personajes · {universe.current ? t("Activo") : t("Cambiar")}</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>)}
          </div>}
        </div>
      </section>
      {isLoaded && isSignedIn && user && activeUniverse && universeMetadata && !universeMetadata.archived && (
        <PrivateShareCards key={`${user.id}:${activeUniverseId}`} universeId={activeUniverseId}
          universeName={universeName}
          description={universeMetadata.description || activeUniverse.creatorSetup?.universeDescription}
          creatorName={user.fullName || user.username || undefined}
          initialCharacterId={activeUniverse.currentCharacterId}
          characters={activeUniverse.characters.filter(character => !character.archived).map(character => ({
            id: character.id, name: character.name,
            imageSrc: hasCharacterImage(character.avatar) ? media(character.avatar, {
              sourceUniverseId: activeUniverseId, sourceCharacterId: character.id,
              sourceType: 'avatar', sourceContentId: character.id,
            }) : undefined,
          }))} />
      )}
      <div className="epc-back-row"><Link href="/creator-preview/account" className="ep-text-link"><ArrowLeft size={15} /> {account ? t("Ver mi plan") : t("Ver plan de ejemplo")}</Link></div>
    </PreviewShell>
  );
}

export function CreatorStorePreview() {
  const t = useCreatorPreviewText();
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow={t("Creator · más espacio")}
        title={t("Más lugar para")}
        accent={t("seguir creando.")}
        description={t("Creator es el espacio para los perfiles. La capacidad depende de Free, Plus o Premium.")}
      />
      <PreviewNotice>{t("Vista ilustrativa. Los perfiles Creator están disponibles en todos los planes; Plus y Premium amplían la capacidad de membresía.")}</PreviewNotice>
      <section className="epc-store-layout" aria-label={t("Opciones ilustrativas de Creator")}>
        <article className="epc-creator-card">
          <span className="epc-price-tag">{t("MÁS CAPACIDAD")}</span>
          <h2>Creator Hub</h2>
          <p>{t("Un espacio ampliado para desarrollar más universos y personajes, a medida que tus ideas crecen.")}</p>
          <div className="epc-creator-visual" aria-hidden="true">
            <div className="epc-creator-orbit epc-creator-orbit-a" /><div className="epc-creator-orbit epc-creator-orbit-b" />
            <span>e</span>
          </div>
          <div className="epc-creator-points"><span><Check size={15} /> Perfiles para todos los planes</span><span><Check size={15} /> Capacidad según membresía</span></div>
          <Link href="/creator-preview/pricing" className="ep-button epc-wide-link">Ver planes de ejemplo <ArrowRight size={15} /></Link>
        </article>
        <div className="epc-store-side">
          <div className="epc-extras-head"><span className="ep-eyebrow">{t("Extras por separado")}</span><p>{t("Capacidad adicional, presentada de forma independiente.")}</p></div>
          <article className="epc-extra-row"><span className="epc-extra-icon"><UsersRound size={18} /></span><div><h3>{t("+1 personaje")}</h3><p>{t("Un espacio adicional para un personaje.")}</p></div><span className="epc-extra-mark">EXTRA</span></article>
          <article className="epc-extra-row"><span className="epc-extra-icon lilac"><Sparkles size={18} /></span><div><h3>{t("+1 universo")}</h3><p>{t("Un universo adicional para otra idea.")}</p></div><span className="epc-extra-mark">EXTRA</span></article>
          <section className="epc-coming-panel" aria-label={t("Funciones futuras")}>
            <span className="ep-overline">{t("EN CAMINO")}</span>
            <div className="epc-coming-item"><Video size={16} /><strong>Video</strong><span>{t("Coming Soon")}</span></div>
          </section>
        </div>
      </section>
      
    </PreviewShell>
  );
}

export function CreatorPrivacyPreview() {
  const t = useCreatorPreviewText();
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow={t("Privacidad · controles")}
        title={t("Cada personaje,")}
        accent={t("sus propios límites.")}
        description={t("Una representación estática de los controles de privacidad que pueden acompañar cada identidad.")}
      />
      <PreviewNotice>{t("Los controles están desactivados. No se cambia ninguna preferencia ni estado social.")}</PreviewNotice>
      <section className="epc-privacy-layout" aria-label={t("Ilustración de privacidad por personaje")}>
        <div className="epc-privacy-rail">
          <div className="epc-privacy-rail-top"><Shield size={17} /><span>{t("PRIVACIDAD")}</span></div>
          <h2>{t('Elige cómo')}<br />{t('aparece cada personaje.')}</h2>
          <p>{t("Los perfiles y las relaciones se ilustran por personaje, no como un estado global.")}</p>
          <div className="epc-profile-types">
            <div><span className="epc-privacy-dot public" /><span><strong>{t("Público")}</strong><small>{t("Visible para explorar")}</small></span></div>
            <div><span className="epc-privacy-dot private" /><span><strong>{t("Privado")}</strong><small>{t("Acceso bajo solicitud")}</small></span></div>
          </div>
        </div>
        <div className="epc-privacy-content">
          <div className="epc-privacy-toolbar"><div><span className="ep-overline">{t("AJUSTES POR PERSONAJE")}</span><h2>{t("Perfiles de muestra")}</h2></div><span className="epc-example-tag">{t("ILUSTRATIVO")}</span></div>
          <article className="epc-privacy-card">
            <div className="epc-privacy-character"><span className="epc-character-avatar rose">A</span><div><strong>{t("Personaje de muestra A")}</strong><small>{t("Perfil público · ejemplo")}</small></div><button className="epc-toggle is-on" type="button" disabled aria-label={t("Privacidad pública, control ilustrativo")}><i /></button></div>
            <div className="epc-privacy-controls"><div className="epc-setting-line"><span><UsersRound size={15} /> Solicitudes para seguir</span><span className="epc-state-pill">{t("Requiere solicitud")}</span></div><div className="epc-setting-line"><span><LockKeyhole size={15} /> Bloqueo por personaje</span><button className="epc-text-control" type="button" disabled>{t('Bloquear')} <ChevronRight size={14} /></button></div></div>
          </article>
          <article className="epc-privacy-card">
            <div className="epc-privacy-character"><span className="epc-character-avatar lilac">B</span><div><strong>{t("Personaje de muestra B")}</strong><small>{t("Perfil privado · ejemplo")}</small></div><button className="epc-toggle" type="button" disabled aria-label={t("Privacidad privada, control ilustrativo")}><i /></button></div>
            <div className="epc-privacy-controls"><div className="epc-setting-line"><span><UsersRound size={15} /> Solicitudes para seguir</span><span className="epc-state-pill">{t("2 ilustrativas")}</span></div><div className="epc-setting-line"><span><LockKeyhole size={15} /> Bloqueo por personaje</span><button className="epc-text-control" type="button" disabled>{t('Desbloquear')} <ChevronRight size={14} /></button></div></div>
          </article>
          <div className="epc-privacy-foot"><CircleHelp size={14} /> Solicitudes y bloqueos mostrados como ejemplos sin estado real.</div>
        </div>
      </section>
      
    </PreviewShell>
  );
}

export function CreatorLimitPreview() {
  const t = useCreatorPreviewText();
  const { isLoaded, isSignedIn, user } = useUser();
  const live = useGetCreatorAccount({ query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: ownerScopedPreviewKey(getGetCreatorAccountQueryKey(), user?.id) } });
  const account = isSignedIn ? live.data : undefined;
  const heading = <PreviewHeading
        eyebrow={t("Estado · capacidad")}
        title={t("Una pausa antes")}
        accent={t("de seguir.")}
        description={t("Así podría verse una orientación cuando un espacio conceptual llega a su capacidad.")}
      />;
  if (!isLoaded || (isSignedIn && !account)) {
    return <PreviewShell>{heading}<OwnerAccountPending loading={!live.isError} onRetry={() => void live.refetch()} /></PreviewShell>;
  }
  if (account) {
    const used = account.characterCount;
    const max = account.maxCharacters;
    const ratio = max > 0 ? Math.min(1, used / max) : 1;
    const full = used >= max;
    return (
      <PreviewShell>
        {heading}
        <div className="epc-modal-stage">
          <div className="epc-modal-backdrop" aria-hidden="true" />
          <section className="epc-limit-dialog" role="dialog" aria-labelledby="epc-limit-title" aria-describedby="epc-limit-description">
            <div className="epc-limit-symbol"><UsersRound size={20} /></div>
            <span className="ep-overline">{t('TU CUENTA · PLAN')} {String(account.plan).toUpperCase()}</span>
            <h2 id="epc-limit-title">{full ? <>{t('Has llegado al límite')}<br />{t('de personajes.')}</> : <>{t('Aún tienes espacio')}<br />{t('para crear.')}</>}</h2>
            <p id="epc-limit-description" data-testid="text-limit-usage">{t('Usas')} {used} {t('de')} {max} {t('personajes y')} {account.universeCount} {t('de')} {account.maxUniverses} {t('universos. Las ampliaciones todavía no están a la venta.')}</p>
            <div className="epc-limit-meter"><div><span>{t("Personajes")}</span><strong>{used} <small>/ {max}</small></strong></div><div className="epc-meter-track"><i style={{ transform: `scaleX(${ratio})`, transformOrigin: 'left' }} /></div><small>{t("Capacidad real de tu cuenta")}</small></div>
            <div className="epc-limit-actions">
              <Link href="/creator-preview/universes" className="ep-button">Ver mis personajes <ArrowRight size={15} /></Link>
              <span className="epc-secondary-link" aria-disabled="true">{t("Ampliaciones pendientes · sin pago")}</span>
            </div>
            <p className="epc-dialog-footnote"><Eye size={13} /> No hay checkout ni cobros conectados.</p>
          </section>
        </div>
        
      </PreviewShell>
    );
  }
  return (
    <PreviewShell>
      {heading}
      <div className="epc-modal-stage">
        <div className="epc-modal-backdrop" aria-hidden="true" />
        <section className="epc-limit-dialog" role="dialog" aria-labelledby="epc-limit-title" aria-describedby="epc-limit-description">
          <div className="epc-limit-symbol"><UsersRound size={20} /></div>
          <span className="ep-overline">{t("EJEMPLO · PLAN FREE")}</span>
          <h2 id="epc-limit-title">{t('Has llegado al límite')}<br />{t('de este universo.')}</h2>
          <p id="epc-limit-description">{t('En este ejemplo, los 5 espacios de personaje están ocupados. Puedes revisar cómo se vería la siguiente opción.')}</p>
          <div className="epc-limit-meter"><div><span>{t("Personajes")}</span><strong>5 <small>/ 5</small></strong></div><div className="epc-meter-track"><i /></div><small>{t("Capacidad conceptual de Free")}</small></div>
          <div className="epc-limit-actions">
            <Link href="/creator-preview/universes" className="ep-button">Vista de añadir personaje <ArrowRight size={15} /></Link>
            <Link href="/creator-preview/store" className="epc-secondary-link">Explorar Creator <ArrowRight size={14} /></Link>
          </div>
          <p className="epc-dialog-footnote"><Eye size={13} /> Vista estática. Ninguna acción se ejecutará.</p>
        </section>
      </div>
      
    </PreviewShell>
  );
}
