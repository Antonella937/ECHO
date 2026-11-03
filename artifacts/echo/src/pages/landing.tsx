import { ArrowDown, ArrowRight, LockKeyhole, MessageCircle, Sparkles, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import './public-surface.css';

function PublicHeader() {
  return (
    <header className="ep-nav">
      <Link href="/" className="ep-brand" aria-label="ECHO, inicio" data-testid="link-echo-home">
        <span className="ep-mark" aria-hidden="true">e</span><span>ECHO</span>
      </Link>
      <nav className="ep-navlinks" aria-label="Navegación principal">
        <Link href="/pricing" data-testid="link-pricing">Planes</Link>
        <Link href="/faq" data-testid="link-faq">Preguntas</Link>
        <Link href="/sign-in" className="ep-button ep-button-quiet" data-testid="link-sign-in">Iniciar sesión</Link>
      </nav>
    </header>
  );
}

function PublicFooter() {
  return (
    <footer className="ep-footer">
      <div className="ep-footer-inner">
        <span>© ECHO · Un espacio privado para tus personajes</span>
        <div className="ep-footer-links"><Link href="/pricing">Planes</Link><Link href="/faq">Preguntas frecuentes</Link><Link href="/sign-in">Iniciar sesión</Link></div>
      </div>
    </footer>
  );
}

export default function LandingPage() {
  return (
    <main className="echo-public">
      <div className="ep-wrap">
        <PublicHeader />
        <section className="ep-hero" aria-labelledby="landing-heading">
          <div className="ep-hero-copy">
            <span className="ep-eyebrow">Tu universo, a puerta cerrada</span>
            <h1 id="landing-heading" className="ep-serif">Un lugar propio<br />para <em>imaginar.</em></h1>
            <p>ECHO es una red social privada para crear personajes, darles una identidad y explorar su mundo desde un mismo espacio.</p>
            <div className="ep-hero-actions">
              <Link href="/sign-up" className="ep-button" data-testid="link-create-account">Crear mi espacio <ArrowRight size={16} /></Link>
              <Link href="/pricing" className="ep-text-link" data-testid="link-explore-plans">Conocer los planes <ArrowRight size={15} /></Link>
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
            <div><span className="ep-eyebrow">Una idea, muchas capas</span><h2 id="experience-heading" className="ep-serif">Empieza con una voz.<br />Construye alrededor.</h2></div>
            <p>Un espacio para organizar identidades y momentos sin mezclarlos con tu vida pública.</p>
          </div>
          <div className="ep-story-grid">
            <article className="ep-story-card"><span className="ep-card-index">01 / IDENTIDAD</span><div><h3>Un personaje que se siente suyo</h3><p>Define un nombre, un usuario y una breve biografía para empezar a darle forma.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">02 / UNIVERSO</span><div><h3>Todo tiene su lugar</h3><p>Tu universo reúne los personajes y la actividad que decidas crear dentro de ECHO.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">03 / EXPRESIÓN</span><div><h3>Texto e imágenes, en beta</h3><p>La experiencia inicial está preparada para expresarse con texto e imágenes, con límites diarios en el plan Free.</p></div></article>
            <article className="ep-story-card"><span className="ep-card-index">04 / A SU TIEMPO</span><div><h3>Sin prometer lo que aún no está</h3><p>Voz, video y música están fuera de beta por ahora. Los estamos dejando para más adelante.</p></div></article>
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
            <div><h3>Una primera versión honesta</h3><p>Los planes no tienen cobros activos. Creator es una selección beta preparada, sin checkout ni cuotas inventadas.</p></div>
            <Link href="/pricing" className="ep-text-link" data-testid="link-see-plan-details">Ver qué incluye cada plan <ArrowRight size={15} /></Link>
          </div>
        </section>

        <section className="ep-section" style={{ paddingTop: 8 }}>
          <div className="ep-beta-strip">
            <div><span className="ep-eyebrow">Cuando estés listo</span><h3 style={{ marginTop: 12 }}>Tu universo empieza con un nombre.</h3><p>Elige un plan beta y crea tu primera identidad en unos pocos pasos.</p></div>
            <Link href="/sign-up" className="ep-button" data-testid="link-start-now">Empezar <ArrowDown size={15} /></Link>
          </div>
        </section>
        <PublicFooter />
      </div>
    </main>
  );
}

export { PublicHeader, PublicFooter };
