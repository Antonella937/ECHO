import React, { useId, useState } from 'react';

/** Decorative glyphs never replace the accessible status label. No timers or data access. */
export function EchoLoader({ size = 56, decorative = false }: { size?: number; decorative?: boolean }) {
  return (
    <span className="echo-loader" role={decorative ? undefined : 'status'}
      aria-label={decorative ? undefined : 'Cargando ECHO'} aria-busy={decorative ? undefined : true}>
      <svg width={size} height={size} viewBox="0 0 200 200" aria-hidden="true" focusable="false">
        <circle cx="100" cy="100" r="63" fill="#30233d" />
        <g className="echo-loader-arcs" fill="none" stroke="#95809f" strokeWidth="1">
          <circle cx="100" cy="100" r="79" opacity=".4" strokeDasharray="165 65 90 176" />
          <circle cx="100" cy="100" r="92" opacity=".23" strokeDasharray="220 75 105 178" />
          <circle cx="100" cy="8" r="2" fill="#b4a0bf" stroke="none" />
          <circle cx="192" cy="100" r="2" fill="#b4a0bf" stroke="none" />
          <circle cx="21" cy="100" r="1.7" fill="#b4a0bf" stroke="none" />
        </g>
        <text x="100" y="93" dominantBaseline="central" textAnchor="middle" fontSize="76"
          fontFamily="'Instrument Serif', Georgia, serif" fill="#e5c5f6">e</text>
      </svg>
    </span>
  );
}

/** Shown only while the existing authentication state is unresolved. Never holds navigation. */
export function EchoSplash() {
  return (
    <div className="echo-splash" role="status" aria-label="Cargando ECHO" aria-busy="true">
      <div className="echo-splash-content">
        <div className="echo-splash-wordmark" aria-hidden="true">ECHO</div>
        <div className="echo-splash-rule" aria-hidden="true" />
        <p className="echo-splash-tagline">EVERY WORLD HAS A STORY</p>
        <EchoLoader size={88} decorative />
      </div>
    </div>
  );
}

export function CreatorSignature({ variant }: { variant: 'created' | 'script' }) {
  return <small className={`echo-signature echo-signature-${variant}`}>
    {variant === 'created' ? 'CREATED BY NELA' : 'nela.'}
  </small>;
}

/** Ephemeral credits only: no session fields, persistence, navigation or network requests. */
export function NelaEasterEgg() {
  const [open, setOpen] = useState(false);
  const id = useId();
  return (
    <div className="echo-nela-egg">
      <button type="button" className="echo-nela-trigger" aria-label="Descubrir el origen de ECHO"
        aria-expanded={open} aria-controls={id} onClick={() => setOpen(value => !value)}
        data-testid="button-nela-credits">N</button>
      <div id={id} hidden={!open} className="echo-nela-response" role="status">
        <p>Un pequeño origen para muchos mundos.</p>
        <CreatorSignature variant="created" />
      </div>
    </div>
  );
}
