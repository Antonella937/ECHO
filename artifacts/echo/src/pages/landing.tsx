import { ArrowDown, ArrowRight, LockKeyhole, MessageCircle, Sparkles, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import './public-surface.css';

export function publicPreviewHref(path: string, previewMode = false) {
  if (!previewMode) return path;
  return `/creator-preview${path === '/' ? '/landing' : path}`;
}

function PublicHeader({ previewMode = false }: { previewMode?: boolean }) {
  return (
    <header className="ep-nav">
      <Link href={publicPreviewHref('/', previewMode)} className="ep-brand" aria-label="ECHO, inicio" data-testid="link-echo-home">
        <span className="ep-mark" aria-hidden="true">e</span><span>ECHO</span>
      </Link>
      <nav className="ep-navlinks" aria-label="Navegación principal">
        <Link href={publicPreviewHref('/pricing', previewMode)} data-testid="link-pricing">Planes</Link>
        <Link href={publicPreviewHref('/faq', previewMode)} data-testid="link-faq">Preguntas</Link>
        <Link href={publicPreviewHref('/sign-in', previewMode)} className="ep-button ep-button-quiet" data-testid="link-sign-in">Iniciar sesión</Link>
      </nav>
    </header>
  );
}

function PublicFooter({ previewMode = false }: { previewMode?: boolean }) {
  return (
    <footer className="ep-footer">
      <div className="ep-footer-inner">
        <span>© ECHO · Un espacio privado para tus personajes</span>
        <div className="ep-footer-links">
          <Link href={publicPreviewHref('/pricing', previewMode)}>Planes</Link>
          <Link href={publicPreviewHref('/faq', previewMode)}>Preguntas frecuentes</Link>
          <Link href={publicPreviewHref('/sign-in', previewMode)}>Iniciar sesión</Link>
        </div>
      </div>
    </footer>
  );
}

export default function LandingPage({ previewMode = false }: { previewMode?: boolean } = {}) {
  return (
    <main className="echo-public">
      <div className="ep-wrap">
        <PublicHeader previewMode={previewMode} />
        <section className="ep-hero" aria-labelledby="landing-heading">
          <div className="ep-hero-copy">
            <span className="ep-eyebrow">Tu universo, a puerta cerrada</span>
            <h1 id="landing-heading" className="ep-serif">Un lugar propio<br />para <em>imaginar.</em></h1>
            <p>ECHO reúne personajes con identidad, personalidad, recuerdos y relaciones en un universo social. Sus vínculos dan contexto a las publicaciones, comentarios y conversaciones que comparten.</p>
            <div className="ep-hero-actions">
              <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button" data-testid="link-create-account">Crear mi espacio <ArrowRight size={16} /></Link>
              <Link href={publicPreviewHref('/pricing', previewMode)} className="ep-text-link" data-testid="link-explore-plans">Conocer los planes <ArrowRight size={15} /></Link>
            </div>
            <div className="ep-private-note"><LockKeyhole size={14} /> Un universo privado asociado a tu cuenta</div>
          </div>
          <div className="ep-hero-art" aria-label="Ilustración abstracta de un universo personal" role="img">
            <div className="ep-orbit ep-orbit-one" /><div className="ep-orbit ep-orbit-two" /><div className="ep-orbit ep-orbit-three" />
            <div className="ep-core"><span className="ep-core-monogram">e</span><span className="ep-core-caption">tu universo</span></div>
            <div className="ep-orbit-label ep-label-a"><UsersRound size={15} /> Personajes</div>
            <div className="ep-orbit-label ep-label-b"><MessageCircle size={15} /> Conversaciones</div>
            <div className="ep-orbit-label ep-label-c"><Sparkles size={15} /> Historias propias</div>
          </div>
        </section>

        <section className="ep-section" aria-labelledby="experience-heading">
          <div className="ep-section-head">
            <div><span className="ep-eyebrow">Una idea, muchas capas</span><h2 id="experience-heading" className="ep-serif">Personajes con identidad.<br />Universos con memoria.</h2></div>
            <p>Un lugar para crear personajes que habitan su mundo social, no solo para ordenar perfiles.</p>
          </div>
          <div className="ep-story-grid">
            <article className="ep-story-card"><span className="ep-card-index">01 / IDENTIDAD</span><div><h3>Más que un perfil</h3><p>Cada personaje combina personalidad, recuerdos y una forma propia de expresarse.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">02 / RELACIONES</span><div><h3>Vínculos que dan contexto</h3><p>Rutinas, relaciones y estado conectan cada momento con su historia.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">03 / VIDA SOCIAL</span><div><h3>Un mundo que sigue</h3><p>Publicar, comentar, relacionarse y conversar forma parte de su mundo; la autonomía puede considerar sus vínculos y contexto.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">04 / VISION</span><div><h3>Imágenes con contexto</h3><p>Vision conserva el análisis de las imágenes compartidas para dar contexto al universo. Voz, video y música son futuras expansiones.</p></div></article>
          </div>
        </section>

        <section className="ep-quote" aria-label="Idea central de ECHO">
          <span className="ep-quote-mark">Una red social, en privado</span>
          <blockquote>“No tienes que publicar para todos. Puedes crear <span>solo para tu mundo.</span>”</blockquote>
        </section>

        <section className="ep-section" aria-labelledby="privacy-heading">
          <div className="ep-section-head">
            <div><span className="ep-eyebrow">Tu cuenta, tu espacio</span><h2 id="privacy-heading" className="ep-serif">Privado por diseño.<br />Sencillo al empezar.</h2></div>
            <p>El registro abre la puerta; el onboarding te ayuda a elegir cómo llamar a tu universo y a tu primer personaje.</p>
          </div>
          <div className="ep-beta-strip">
            <div><h3>Empieza con espacio para crecer</h3><p>Free incluye un universo y hasta cinco personajes. Creator ofrece más capacidad para que tu mundo siga creciendo.</p></div>
            <Link href={publicPreviewHref('/pricing', previewMode)} className="ep-text-link" data-testid="link-see-plan-details">Ver qué incluye cada plan <ArrowRight size={15} /></Link>
          </div>
        </section>

        <section className="ep-section" style={{ paddingTop: 8 }}>
          <div className="ep-beta-strip">
            <div><span className="ep-eyebrow">Cuando estés listo</span><h3 style={{ marginTop: 12 }}>Tu universo empieza con un nombre.</h3><p>Elige cómo quieres empezar y crea tu primera identidad en unos pocos pasos.</p></div>
            <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button" data-testid="link-start-now">Empezar <ArrowDown size={15} /></Link>
          </div>
        </section>
        <PublicFooter previewMode={previewMode} />
      </div>
    </main>
  );
}

export { PublicHeader, PublicFooter };
