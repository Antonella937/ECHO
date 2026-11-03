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
import { PublicFooter, PublicHeader } from './landing';
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
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow="Cuenta · plan"
        title="Tu espacio, a"
        accent="tu ritmo."
        description="Una vista de ejemplo para entender qué acompaña a una cuenta ECHO Creator."
      />
      <PreviewNotice>Datos ilustrativos: esta pantalla no está conectada a tu cuenta ni refleja uso real.</PreviewNotice>
      <section className="epc-account-layout" aria-label="Resumen ilustrativo de cuenta">
        <article className="epc-plan-panel">
          <div className="epc-panel-topline"><span>PLAN DE EJEMPLO</span><span className="epc-status">Activo · ilustrativo</span></div>
          <div className="epc-plan-name"><span className="epc-plan-monogram">e</span><div><span>Plan actual</span><h2>Free</h2></div></div>
          <p className="epc-panel-copy">Un comienzo para crear un universo privado y darle forma a sus personajes.</p>
          <div className="epc-capacity">
            <div><span>Universos</span><strong>1 universo</strong></div>
            <div className="epc-capacity-rule" aria-hidden="true"><i /></div>
            <div><span>Personajes</span><strong>Hasta 5 personajes</strong></div>
          </div>
          <Link href="/creator-preview/store" className="ep-button epc-wide-link">Explorar Creator <ArrowRight size={15} /></Link>
        </article>
        <article className="epc-activity-panel">
          <div className="epc-panel-title"><span className="epc-icon-tile"><Sparkles size={17} /></span><div><span>Herramientas</span><h2>Lo que puedes explorar</h2></div></div>
          <div className="epc-tool-row"><span className="epc-tool-icon"><WandSparkles size={16} /></span><div><strong>IA</strong><small>Uso con límites diarios en Free</small></div><span className="epc-tool-state">Disponible</span></div>
          <div className="epc-tool-row"><span className="epc-tool-icon"><Image size={16} /></span><div><strong>Imágenes</strong><small>Límites de uso por definir</small></div><span className="epc-tool-state">Por definir</span></div>
          <div className="epc-tool-row"><span className="epc-tool-icon"><Eye size={16} /></span><div><strong>Vision</strong><small>Contexto de imágenes compartidas</small></div><span className="epc-tool-state">Disponible</span></div>
          <p className="epc-subtle-note">El uso se muestra sin cifras: no hay actividad real en esta vista.</p>
        </article>
      </section>
      <div className="epc-back-row"><Link href="/creator-preview" className="ep-text-link"><ArrowLeft size={15} /> Pantallas de revisión</Link></div>
    </PreviewShell>
  );
}

export function CreatorUniversePreview() {
  const sampleSlots = [true, true, true, false, false];
  return (
    <PreviewShell>
      <PreviewHeading
        eyebrow="Tu universo · personajes"
        title="Un lugar para"
        accent="cada personaje."
        description="Una composición de muestra para visualizar cómo se organiza un universo y sus personajes."
      />
      <PreviewNotice>Ilustración con conteos de ejemplo. No muestra personajes reales ni permite cambios.</PreviewNotice>
      <section className="epc-universe-board" aria-label="Ilustración de gestión de universo">
        <div className="epc-universe-sidebar">
          <div className="epc-universe-symbol">e</div>
          <span className="epc-overline">UNIVERSO DE EJEMPLO</span>
          <h2>Casa de papel</h2>
          <p>Un espacio privado para reunir personajes, ideas y conversaciones.</p>
          <div className="epc-universe-stats">
            <div><span>Universos usados</span><strong>1 <small>/ 1</small></strong></div>
            <div><span>Personajes usados</span><strong>3 <small>/ 5</small></strong></div>
          </div>
          <div className="epc-slot-label"><span>Capacidad de ejemplo</span><span>3 de 5</span></div>
          <div className="epc-slots" aria-label="Tres de cinco espacios ilustrativos ocupados">
            {sampleSlots.map((filled, index) => <i key={index} className={filled ? 'is-filled' : ''} />)}
          </div>
          <small className="epc-caption">Muestra conceptual de Free</small>
        </div>
        <div className="epc-characters-area">
          <div className="epc-characters-head"><div><span className="ep-overline">COLECCIÓN</span><h2>Personajes</h2></div><span className="epc-example-tag">EJEMPLO</span></div>
          <div className="epc-character-list">
            {[
              { monogram: 'A', label: 'Personaje de muestra A', tint: 'rose' },
              { monogram: 'B', label: 'Personaje de muestra B', tint: 'lilac' },
              { monogram: 'C', label: 'Personaje de muestra C', tint: 'sand' },
            ].map((character) => (
              <div className="epc-character-row" key={character.monogram}>
                <span className={`epc-character-avatar ${character.tint}`} aria-hidden="true">{character.monogram}</span>
                <span className="epc-character-name">{character.label}<small>Perfil privado · muestra</small></span>
                <ChevronRight size={16} aria-hidden="true" />
              </div>
            ))}
          </div>
          <button className="epc-add-character" type="button" disabled aria-label="Añadir personaje, solo ilustrativo">
            <span><Plus size={16} /></span><strong>Añadir personaje</strong><small>Acción ilustrativa</small>
          </button>
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
