import { ArrowRight, Check, Image as ImageIcon, Type } from 'lucide-react';
import { Link } from 'wouter';
import { PublicFooter, PublicHeader, publicPreviewHref } from './landing';
import './public-surface.css';

export default function PricingPage({ previewMode = false }: { previewMode?: boolean } = {}) {
  return (
    <main className="echo-public">
      <div className="ep-wrap">
        <PublicHeader previewMode={previewMode} />
        <section className="ep-page-intro">
          <span className="ep-eyebrow">Planes ECHO Creator</span>
          <h1 className="ep-serif">Dos formas de<br /><em style={{ color: 'var(--ep-rose)' }}>empezar.</em></h1>
          <p>Sin precios ficticios ni checkout. Los planes no cobran actualmente: Free está disponible y Creator es una selección beta preparada.</p>
        </section>
        <section className="ep-pricing-grid" aria-label="Planes disponibles">
          <article className="ep-price-card">
            <span className="ep-price-tag">Disponible</span>
            <h2>Free</h2>
            <p>Una manera sencilla de abrir tu universo privado y empezar a crear.</p>
            <div className="ep-no-price">Sin cobro activo<small>El plan no requiere pago</small></div>
            <ul className="ep-included">
              <li><Check size={15} /> Un universo privado asociado a tu cuenta</li>
              <li><Type size={15} /> Texto con límites diarios</li>
              <li><ImageIcon size={15} /> Imágenes con límites diarios</li>
              <li><Check size={15} /> Selección de tu primer personaje en onboarding</li>
            </ul>
            <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button ep-button-quiet" data-testid="link-free-signup">Empezar con Free <ArrowRight size={15} /></Link>
          </article>
          <article className="ep-price-card is-featured">
            <span className="ep-price-tag">Beta · selección preparada</span>
            <h2>Creator</h2>
            <p>Una opción beta para quienes quieren comenzar como creadores.</p>
            <div className="ep-no-price">Sin cobro activo<small>No hay checkout ni cuotas publicadas</small></div>
            <ul className="ep-included">
              <li><Check size={15} /> Plan Creator guardado en la configuración inicial</li>
              <li><Type size={15} /> Texto e imágenes: capacidades en beta</li>
              <li><Check size={15} /> Sin cobros activos ni checkout</li>
              <li><Check size={15} /> Voz, video y música aún no disponibles</li>
            </ul>
            <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button" data-testid="link-creator-signup">Elegir Creator en beta <ArrowRight size={15} /></Link>
          </article>
        </section>
        <section className="ep-plan-footnote" aria-label="Nota sobre disponibilidad"><strong>Sobre la beta.</strong> Texto e imágenes tienen límites diarios en Free; los números no se publican aquí. Creator está preparado como selección beta, sin cuotas ni capacidades específicas anunciadas. Voz, video y música quedan fuera de beta por ahora.</section>
        <section className="ep-section" style={{ paddingTop: 58 }}>
          <div className="ep-section-head"><div><span className="ep-eyebrow">Disponibilidad</span><h2 className="ep-serif">Lo que está aquí.<br />Y lo que todavía no.</h2></div><p>Preferimos explicar con claridad qué parte de la experiencia está disponible hoy.</p></div>
          <div className="ep-capability-table" role="table" aria-label="Disponibilidad de funciones">
            <div className="ep-capability-row" role="row"><span role="columnheader">Función</span><span role="columnheader">Free</span><span role="columnheader">Creator beta</span></div>
            <div className="ep-capability-row" role="row"><span role="cell">Texto e imágenes</span><span role="cell">Límites diarios</span><span role="cell">En beta</span></div>
            <div className="ep-capability-row" role="row"><span role="cell">Voz, video y música</span><span className="ep-coming" role="cell">Próximamente</span><span className="ep-coming" role="cell">Fuera de beta</span></div>
          </div>
        </section>
        <PublicFooter previewMode={previewMode} />
      </div>
    </main>
  );
}
