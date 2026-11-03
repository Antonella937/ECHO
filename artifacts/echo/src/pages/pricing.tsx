import { ArrowRight, Check, Image as ImageIcon, Type, UsersRound } from 'lucide-react';
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
          <p>Empieza con un universo propio y amplía el espacio para tus personajes cuando tu mundo crezca.</p>
        </section>
        <section className="ep-pricing-grid" aria-label="Planes disponibles">
          <article className="ep-price-card">
            <span className="ep-price-tag">Para empezar</span>
            <h2>Free</h2>
            <p>Todo lo esencial para abrir tu universo y darle vida a sus primeros personajes.</p>
            <div className="ep-no-price">Gratis<small>Un universo y hasta cinco personajes</small></div>
            <ul className="ep-included">
              <li><Check size={15} /> Un universo privado</li>
              <li><UsersRound size={15} /> Hasta cinco personajes</li>
              <li><Type size={15} /> Publicaciones, comentarios y conversaciones</li>
              <li><ImageIcon size={15} /> Imágenes con Vision para aportar contexto</li>
            </ul>
            <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button ep-button-quiet" data-testid="link-free-signup">Empezar con Free <ArrowRight size={15} /></Link>
          </article>
          <article className="ep-price-card is-featured">
            <span className="ep-price-tag">Más espacio</span>
            <h2>Creator</h2>
            <p>Más capacidad para que tu universo y tus personajes sigan creciendo.</p>
            <div className="ep-no-price">Más capacidad<small>Detalles de Creator próximamente</small></div>
            <ul className="ep-included">
              <li><Check size={15} /> Más espacio para universos y personajes</li>
              <li><Type size={15} /> La experiencia social de ECHO</li>
              <li><ImageIcon size={15} /> Texto e imágenes con Vision contextual</li>
              <li><Check size={15} /> Voz, video y música como futuras expansiones</li>
            </ul>
            <Link href={publicPreviewHref('/sign-up', previewMode)} className="ep-button" data-testid="link-creator-signup">Empezar con Creator <ArrowRight size={15} /></Link>
          </article>
        </section>
        <section className="ep-plan-footnote" aria-label="Disponibilidad de planes"><strong>Sobre el uso.</strong> Los límites de IA, imágenes y Vision se anunciarán cuando estén definidos. Creator ofrecerá más capacidad; sus detalles se compartirán próximamente. Voz, video y música son futuras expansiones.</section>
        <section className="ep-section" style={{ paddingTop: 58 }}>
          <div className="ep-section-head"><div><span className="ep-eyebrow">Disponibilidad</span><h2 className="ep-serif">Lo que está aquí.<br />Y lo que todavía no.</h2></div><p>Preferimos explicar con claridad qué parte de la experiencia está disponible hoy.</p></div>
          <div className="ep-capability-table" role="table" aria-label="Disponibilidad de funciones">
            <div className="ep-capability-row" role="row"><span role="columnheader">Experiencia</span><span role="columnheader">Free</span><span role="columnheader">Creator</span></div>
            <div className="ep-capability-row" role="row"><span role="cell">Universos y personajes</span><span role="cell">1 universo · hasta 5 personajes</span><span role="cell">Más capacidad</span></div>
            <div className="ep-capability-row" role="row"><span role="cell">IA, imágenes y Vision</span><span role="cell">Límites por anunciar</span><span role="cell">Detalles próximamente</span></div>
            <div className="ep-capability-row" role="row"><span role="cell">Voz, video y música</span><span className="ep-coming" role="cell">Coming Soon</span><span className="ep-coming" role="cell">Coming Soon</span></div>
          </div>
        </section>
        <PublicFooter previewMode={previewMode} />
      </div>
    </main>
  );
}
