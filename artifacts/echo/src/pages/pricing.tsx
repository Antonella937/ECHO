import { ArrowRight, Check, UsersRound } from 'lucide-react';
import { Link } from 'wouter';
import { PublicFooter, PublicHeader, publicPreviewHref } from './landing';
import './public-surface.css';

const plans = [
  { name: 'Free', tag: 'Para empezar', worlds: 1, characters: 5, detail: 'Tu primer universo privado y las herramientas sociales esenciales.' },
  { name: 'Plus', tag: 'Más espacio', worlds: 3, characters: 15, detail: 'Más mundos y personajes, con acceso a voces básicas cuando se habiliten.' },
  { name: 'Premium', tag: 'Experiencia ampliada', worlds: 5, characters: 25, detail: 'Toda la capacidad Premium y acceso a futuras voces personalizadas cuando se lancen.' },
] as const;

export default function PricingPage({ previewMode = false }: { previewMode?: boolean } = {}) {
  return <main className="echo-public"><div className="ep-wrap">
    <PublicHeader previewMode={previewMode} />
    <section className="ep-page-intro"><span className="ep-eyebrow">Membresías ECHO</span><h1 className="ep-serif">Tres formas de<br /><em style={{ color: 'var(--ep-rose)' }}>crear tu mundo.</em></h1><p>Free, Plus y Premium son las membresías de ECHO. Creator es el espacio de perfiles, no un plan de pago.</p></section>
    <section className="ep-pricing-grid" aria-label="Planes disponibles" style={{ gridTemplateColumns: 'repeat(auto-fit, minmax(min(100%, 240px), 1fr))' }}>
      {plans.map((plan, index) => <article key={plan.name} className={`ep-price-card${index === 1 ? ' is-featured' : ''}`}>
        <span className="ep-price-tag">{plan.tag}</span><h2>{plan.name}</h2><p>{plan.detail}</p>
        <div className="ep-no-price">{plan.name === 'Free' ? 'Gratis' : 'Próximamente'}<small>{plan.worlds} {plan.worlds === 1 ? 'mundo' : 'mundos'} · hasta {plan.characters} personajes en total</small></div>
        <ul className="ep-included"><li><Check size={15} /> {plan.worlds} {plan.worlds === 1 ? 'universo privado' : 'universos privados'}</li><li><UsersRound size={15} /> Hasta {plan.characters} personajes entre todos tus mundos</li><li><Check size={15} /> Publicaciones, mensajes y perfiles Creator</li></ul>
        <Link href={publicPreviewHref('/sign-up', previewMode)} className={`ep-button${index === 0 ? ' ep-button-quiet' : ''}`}>{plan.name === 'Free' ? 'Empezar gratis' : 'Explorar ECHO'} <ArrowRight size={15}/></Link>
      </article>)}
    </section>
    <section className="ep-plan-footnote"><strong>Beta privada.</strong> Plus y Premium todavía no pueden contratarse. Las voces, la música y el video requieren habilitación técnica; los costos de IA y proveedores externos son independientes de la membresía. Los cupos publicados son límites comerciales iniciales y pueden revisarse antes del lanzamiento.</section>
    <PublicFooter previewMode={previewMode}/>
  </div></main>;
}
