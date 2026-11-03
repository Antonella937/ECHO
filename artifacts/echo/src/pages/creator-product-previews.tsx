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
import { useState } from 'react';
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

function PreviewShell({ children }: { children: React.ReactNode }) {
  return (
    <main className="echo-public epc-shell">
      <div className="ep-wrap">
        <PublicHeader previewMode />
        {children}
        <PublicFooter previewMode />
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

function PreviewHeading({
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

export function CreatorAccountPreview() {
  const { isLoaded, isSignedIn } = useUser();
  const live = useGetCreatorAccount({ query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: getGetCreatorAccountQueryKey() } });
  const account = isSignedIn ? live.data : undefined;
  const usage = account?.usage;
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow="Cuenta · plan"
        title="Tu espacio, a"
        accent="tu ritmo."
        description="Una vista de ejemplo para entender qué acompaña a una cuenta ECHO Creator."
      />
      <PreviewNotice>{account ? 'Plan, capacidad y uso de IA de tu cuenta. Los cobros todavía no están conectados.' : 'Datos ilustrativos: inicia sesión para ver el plan y el uso reales de tu cuenta.'}</PreviewNotice>
      <section className="epc-account-layout" aria-label="Resumen ilustrativo de cuenta">
        <article className="epc-plan-panel">
          <div className="epc-panel-topline"><span>{account ? 'TU PLAN' : 'PLAN DE EJEMPLO'}</span><span className="epc-status">{account ? 'Activo · sin cobros' : 'Activo · ilustrativo'}</span></div>
          <div className="epc-plan-name"><span className="epc-plan-monogram">e</span><div><span>Plan actual</span><h2>{account?.plan === 'creator' ? 'Creator' : 'Free'}</h2></div></div>
          <p className="epc-panel-copy">Un comienzo para crear un universo privado y darle forma a sus personajes.</p>
          <div className="epc-capacity">
            <div><span>Universos</span><strong>{account ? `${account.universeCount} / ${account.maxUniverses}` : '1 universo'}</strong></div>
            <div className="epc-capacity-rule" aria-hidden="true"><i /></div>
            <div><span>Personajes</span><strong>{account ? `${account.characterCount} / ${account.maxCharacters}` : 'Hasta 5 personajes'}</strong></div>
          </div>
          <Link href="/creator-preview/store" className="ep-button epc-wide-link">{account?.plan === 'creator' ? 'Ver capacidad Creator' : 'Explorar Creator'} <ArrowRight size={15} /></Link>
        </article>
        <article className="epc-activity-panel">
          <div className="epc-panel-title"><span className="epc-icon-tile"><Sparkles size={17} /></span><div><span>Herramientas</span><h2>Lo que puedes explorar</h2></div></div>
          {[
            { key: 'brain_text', label: 'Texto · Brain', icon: <WandSparkles size={16} /> },
            { key: 'autonomy', label: 'Autonomy', icon: <Sparkles size={16} /> },
            { key: 'memory_context', label: 'Memoria y contexto', icon: <MessageCircle size={16} /> },
            { key: 'vision', label: 'Vision', icon: <Eye size={16} /> },
            { key: 'images', label: 'Imágenes', icon: <Image size={16} /> },
          ].map(item => {
            const entry = usage?.categories[item.key as keyof NonNullable<typeof usage>['categories']];
            return <div className="epc-tool-row" key={item.key}>
              <span className="epc-tool-icon">{item.icon}</span>
              <div><strong>{item.label}</strong><small>{account ? `${entry?.calls ?? 0} operaciones · ${entry?.units ?? 0} unidades internas este mes` : 'Consumo mensual por categoría'}</small></div>
              <span className="epc-tool-state">{account ? 'Registrado' : 'Por definir'}</span>
            </div>;
          })}
          <p className="epc-subtle-note">{account
            ? 'El consumo se controla de forma interna; los límites visibles de IA se definirán más adelante.'
            : 'No se muestran límites numéricos de IA hasta calibrarlos con costos reales.'}</p>
        </article>
      </section>
      <div className="epc-back-row"><Link href="/creator-preview" className="ep-text-link"><ArrowLeft size={15} /> Pantallas de revisión</Link></div>
    </PreviewShell>
  );
}

export function CreatorUniversePreview() {
  const { isLoaded, isSignedIn, user } = useUser();
  const accountQuery = useGetCreatorAccount({ query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: getGetCreatorAccountQueryKey() } });
  const account = isSignedIn ? accountQuery.data : undefined;
  const activeUniverseId = user?.id ? getActiveUniverseId(user.id) : 'primary';
  const universesQuery = useListCreatorUniverses({ universeId: activeUniverseId }, {
    query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: getListCreatorUniversesQueryKey({ universeId: activeUniverseId }) },
  });
  const activeUniverseQuery = useGetUniverse({ universeId: activeUniverseId }, {
    query: { enabled: isLoaded && Boolean(isSignedIn), queryKey: getGetUniverseQueryKey({ universeId: activeUniverseId }) },
  });
  const universes = universesQuery.data ?? [];
  const activeUniverse = activeUniverseQuery.data?.state ?? null;
  const slots = account ? Array.from({ length: Math.min(account.maxCharacters, 25) },
    (_, index) => index < account.characterCount) : [true, true, true, false, false];
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
    const name = window.prompt('Nombre del nuevo universo');
    if (!name?.trim()) return;
    setActionError(null);
    try {
      const plan = account?.plan ?? 'free';
      const state = createStarterUniverse({
        plan, universeName: name.trim(), displayName: 'Nela Paez', username: 'nela', bio: '',
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
        eyebrow="Tu universo · personajes"
        title="Un lugar para"
        accent="cada personaje."
        description={account ? 'Tus universos y personajes, con capacidad sincronizada desde tu cuenta.' : 'Una composición de muestra para visualizar cómo se organiza un universo y sus personajes.'}
      />
      <PreviewNotice>{account ? 'Datos privados de tu cuenta. Los extras mostrados no están disponibles para compra todavía.' : 'Ilustración con conteos de ejemplo. Inicia sesión para ver y gestionar tus datos.'}</PreviewNotice>
      <section className="epc-universe-board" aria-label="Ilustración de gestión de universo">
        <div className="epc-universe-sidebar">
          <div className="epc-universe-symbol">e</div>
          <span className="epc-overline">{account ? 'TU UNIVERSO ACTIVO' : 'UNIVERSO DE EJEMPLO'}</span>
          <h2>{activeUniverse?.creatorSetup?.universeName ?? (account ? 'Mi universo' : 'Casa de papel')}</h2>
          <p>Un espacio privado para reunir personajes, ideas y conversaciones.</p>
          <div className="epc-universe-stats">
            <div><span>Universos usados</span><strong>{account ? `${account.universeCount} ` : '1 '}<small>/ {account?.maxUniverses ?? 1}</small></strong></div>
            <div><span>Personajes usados</span><strong>{account ? `${account.characterCount} ` : '3 '}<small>/ {account?.maxCharacters ?? 5}</small></strong></div>
          </div>
          <div className="epc-slot-label"><span>{account ? 'Capacidad de personajes' : 'Capacidad de ejemplo'}</span><span>{account ? `${account.characterCount} de ${account.maxCharacters}` : '3 de 5'}</span></div>
          <div className="epc-slots" aria-label="Capacidad de personajes">
            {slots.map((filled, index) => <i key={index} className={filled ? 'is-filled' : ''} />)}
          </div>
          {account && <button type="button" className="epc-caption" onClick={() => void addUniverse()} disabled={createUniverse.isPending || account.universeCount >= account.maxUniverses}>
            {createUniverse.isPending ? 'Creando…' : account.universeCount >= account.maxUniverses ? 'Cupo de universos alcanzado' : 'Añadir universo'}
          </button>}
          {!account && <small className="epc-caption">Muestra conceptual de Free</small>}
        </div>
        <div className="epc-characters-area">
          <div className="epc-characters-head"><div><span className="ep-overline">COLECCIÓN</span><h2>Personajes</h2></div><span className="epc-example-tag">EJEMPLO</span></div>
          <div className="epc-character-list">
            {(account && activeUniverse ? activeUniverse.characters.filter(character => !character.archived).map(character => ({
              monogram: character.name.trim().charAt(0).toUpperCase() || 'E',
              label: character.name,
              tint: 'rose',
              handle: character.handle,
            })) : [
              { monogram: 'A', label: 'Personaje de muestra A', tint: 'rose' },
              { monogram: 'B', label: 'Personaje de muestra B', tint: 'lilac' },
              { monogram: 'C', label: 'Personaje de muestra C', tint: 'sand' },
            ]).map((character) => (
              <div className="epc-character-row" key={character.monogram}>
                <span className={`epc-character-avatar ${character.tint}`} aria-hidden="true">{character.monogram}</span>
                <span className="epc-character-name">{character.label}<small>{account ? `@${'handle' in character ? character.handle : ''}` : 'Perfil privado · muestra'}</small></span>
                <ChevronRight size={16} aria-hidden="true" />
              </div>
            ))}
          </div>
          <button className="epc-add-character" type="button" disabled={!account} onClick={createCharacter} aria-label="Añadir personaje">
            <span><Plus size={16} /></span><strong>Añadir personaje</strong><small>{account ? atCharacterLimit ? 'Límite alcanzado' : 'En este universo' : 'Acción ilustrativa'}</small>
          </button>
          {actionError && <p role="alert" className="epc-subtle-note">{actionError}</p>}
          {account && universes.length > 1 && <div className="epc-character-list" aria-label="Tus universos">
            {universes.map(universe => <button key={universe.universeId} type="button" className="epc-character-row w-full text-left"
              onClick={() => {
                if (user && universe.universeId !== activeUniverseId) {
                  setActiveUniverseId(user.id, universe.universeId);
                  window.location.assign('/');
                }
              }}>
              <span className="epc-character-avatar lilac" aria-hidden="true">e</span>
              <span className="epc-character-name">{universe.name}<small>{universe.characterCount} personajes · {universe.current ? 'Activo' : 'Cambiar'}</small></span>
              <ChevronRight size={16} aria-hidden="true" />
            </button>)}
          </div>}
        </div>
      </section>
      <div className="epc-back-row"><Link href="/creator-preview/account" className="ep-text-link"><ArrowLeft size={15} /> Ver plan de ejemplo</Link></div>
    </PreviewShell>
  );
}

export function CreatorStorePreview() {
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow="Creator · más espacio"
        title="Más lugar para"
        accent="seguir creando."
        description="Creator está pensado para quienes quieren ampliar el espacio de su universo."
      />
      <PreviewNotice>Vista ilustrativa. Creator ofrece más espacio y los extras se presentan por separado.</PreviewNotice>
      <section className="epc-store-layout" aria-label="Opciones ilustrativas de Creator">
        <article className="epc-creator-card">
          <span className="epc-price-tag">MÁS CAPACIDAD</span>
          <h2>Creator</h2>
          <p>Un espacio ampliado para desarrollar más universos y personajes, a medida que tus ideas crecen.</p>
          <div className="epc-creator-visual" aria-hidden="true">
            <div className="epc-creator-orbit epc-creator-orbit-a" /><div className="epc-creator-orbit epc-creator-orbit-b" />
            <span>e</span>
          </div>
          <div className="epc-creator-points"><span><Check size={15} /> Mayor capacidad</span><span><Check size={15} /> Más espacio para crear</span></div>
          <Link href="/creator-preview/pricing" className="ep-button epc-wide-link">Ver planes de ejemplo <ArrowRight size={15} /></Link>
        </article>
        <div className="epc-store-side">
          <div className="epc-extras-head"><span className="ep-eyebrow">Extras por separado</span><p>Capacidad adicional, presentada de forma independiente.</p></div>
          <article className="epc-extra-row"><span className="epc-extra-icon"><UsersRound size={18} /></span><div><h3>+1 personaje</h3><p>Un espacio adicional para un personaje.</p></div><span className="epc-extra-mark">EXTRA</span></article>
          <article className="epc-extra-row"><span className="epc-extra-icon lilac"><Sparkles size={18} /></span><div><h3>+1 universo</h3><p>Un universo adicional para otra idea.</p></div><span className="epc-extra-mark">EXTRA</span></article>
          <section className="epc-coming-panel" aria-label="Funciones futuras">
            <span className="ep-overline">EN CAMINO</span>
            <div className="epc-coming-item"><AudioLines size={16} /><strong>Voice</strong><span>Coming Soon</span></div>
            <div className="epc-coming-item"><Video size={16} /><strong>Video</strong><span>Coming Soon</span></div>
            <div className="epc-coming-item"><MessageCircle size={16} /><strong>Music</strong><span>Coming Soon</span></div>
          </section>
        </div>
      </section>
      <div className="epc-back-row"><Link href="/creator-preview" className="ep-text-link"><ArrowLeft size={15} /> Pantallas de revisión</Link></div>
    </PreviewShell>
  );
}

export function CreatorPrivacyPreview() {
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow="Privacidad · controles"
        title="Cada personaje,"
        accent="sus propios límites."
        description="Una representación estática de los controles de privacidad que pueden acompañar cada identidad."
      />
      <PreviewNotice>Los controles están desactivados. No se cambia ninguna preferencia ni estado social.</PreviewNotice>
      <section className="epc-privacy-layout" aria-label="Ilustración de privacidad por personaje">
        <div className="epc-privacy-rail">
          <div className="epc-privacy-rail-top"><Shield size={17} /><span>PRIVACIDAD</span></div>
          <h2>Elige cómo<br />aparece cada personaje.</h2>
          <p>Los perfiles y las relaciones se ilustran por personaje, no como un estado global.</p>
          <div className="epc-profile-types">
            <div><span className="epc-privacy-dot public" /><span><strong>Público</strong><small>Visible para explorar</small></span></div>
            <div><span className="epc-privacy-dot private" /><span><strong>Privado</strong><small>Acceso bajo solicitud</small></span></div>
          </div>
        </div>
        <div className="epc-privacy-content">
          <div className="epc-privacy-toolbar"><div><span className="ep-overline">AJUSTES POR PERSONAJE</span><h2>Perfiles de muestra</h2></div><span className="epc-example-tag">ILUSTRATIVO</span></div>
          <article className="epc-privacy-card">
            <div className="epc-privacy-character"><span className="epc-character-avatar rose">A</span><div><strong>Personaje de muestra A</strong><small>Perfil público · ejemplo</small></div><button className="epc-toggle is-on" type="button" disabled aria-label="Privacidad pública, control ilustrativo"><i /></button></div>
            <div className="epc-privacy-controls"><div className="epc-setting-line"><span><UsersRound size={15} /> Solicitudes para seguir</span><span className="epc-state-pill">Requiere solicitud</span></div><div className="epc-setting-line"><span><LockKeyhole size={15} /> Bloqueo por personaje</span><button className="epc-text-control" type="button" disabled>Bloquear <ChevronRight size={14} /></button></div></div>
          </article>
          <article className="epc-privacy-card">
            <div className="epc-privacy-character"><span className="epc-character-avatar lilac">B</span><div><strong>Personaje de muestra B</strong><small>Perfil privado · ejemplo</small></div><button className="epc-toggle" type="button" disabled aria-label="Privacidad privada, control ilustrativo"><i /></button></div>
            <div className="epc-privacy-controls"><div className="epc-setting-line"><span><UsersRound size={15} /> Solicitudes para seguir</span><span className="epc-state-pill">2 ilustrativas</span></div><div className="epc-setting-line"><span><LockKeyhole size={15} /> Bloqueo por personaje</span><button className="epc-text-control" type="button" disabled>Desbloquear <ChevronRight size={14} /></button></div></div>
          </article>
          <div className="epc-privacy-foot"><CircleHelp size={14} /> Solicitudes y bloqueos mostrados como ejemplos sin estado real.</div>
        </div>
      </section>
      <div className="epc-back-row"><Link href="/creator-preview/account" className="ep-text-link"><ArrowLeft size={15} /> Ver cuenta de ejemplo</Link></div>
    </PreviewShell>
  );
}

export function CreatorLimitPreview() {
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow="Estado · capacidad"
        title="Una pausa antes"
        accent="de seguir."
        description="Así podría verse una orientación cuando un espacio conceptual llega a su capacidad."
      />
      <div className="epc-modal-stage">
        <div className="epc-modal-backdrop" aria-hidden="true" />
        <section className="epc-limit-dialog" role="dialog" aria-labelledby="epc-limit-title" aria-describedby="epc-limit-description">
          <div className="epc-limit-symbol"><UsersRound size={20} /></div>
          <span className="ep-overline">EJEMPLO · PLAN FREE</span>
          <h2 id="epc-limit-title">Has llegado al límite<br />de este universo.</h2>
          <p id="epc-limit-description">En este ejemplo, los 5 espacios de personaje están ocupados. Puedes revisar cómo se vería la siguiente opción.</p>
          <div className="epc-limit-meter"><div><span>Personajes</span><strong>5 <small>/ 5</small></strong></div><div className="epc-meter-track"><i /></div><small>Capacidad conceptual de Free</small></div>
          <div className="epc-limit-actions">
            <Link href="/creator-preview/universes" className="ep-button">Vista de añadir personaje <ArrowRight size={15} /></Link>
            <Link href="/creator-preview/store" className="epc-secondary-link">Explorar Creator <ArrowRight size={14} /></Link>
          </div>
          <p className="epc-dialog-footnote"><Eye size={13} /> Vista estática. Ninguna acción se ejecutará.</p>
        </section>
      </div>
      <div className="epc-back-row"><Link href="/creator-preview" className="ep-text-link"><ArrowLeft size={15} /> Pantallas de revisión</Link></div>
    </PreviewShell>
  );
}
