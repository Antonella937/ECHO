import { ArrowLeft, ArrowRight, Eye, LockKeyhole } from 'lucide-react';
import { Link } from 'wouter';
import { publicPreviewHref } from './landing';
import './public-surface.css';

const publicScreens = [
  { href: '/creator-preview/landing', label: 'Landing', detail: 'Entrada pública de ECHO Creator' },
  { href: '/creator-preview/pricing', label: 'Planes', detail: 'Free y Creator' },
  { href: '/creator-preview/faq', label: 'FAQ', detail: 'Preguntas frecuentes' },
  { href: '/creator-preview/sign-in', label: 'Login', detail: 'Vista visual, sin iniciar sesión' },
  { href: '/creator-preview/sign-up', label: 'Registro', detail: 'Vista visual, sin crear cuenta' },
  { href: '/creator-preview/account', label: 'Mi plan', detail: 'Cuenta, capacidad y uso ilustrativo' },
  { href: '/creator-preview/universes', label: 'Universos y personajes', detail: 'Cupos y gestión conceptual' },
  { href: '/creator-preview/store', label: 'Creator y extras', detail: 'Más capacidad y expansiones' },
  { href: '/creator-preview/privacy', label: 'Privacidad social', detail: 'Perfiles, solicitudes y bloqueos' },
  { href: '/creator-preview/limit', label: 'Límite alcanzado', detail: 'Estado conceptual de Free' },
];

export function PublicReviewHub() {
  return (
    <main className="echo-public ep-review-hub">
      <div className="ep-wrap">
        <header className="ep-nav">
          <span className="ep-brand"><span className="ep-mark" aria-hidden="true">e</span><span>ECHO</span></span>
          <span className="ep-review-badge"><Eye size={14} /> Modo revisión</span>
        </header>
        <section className="ep-review-intro">
          <span className="ep-eyebrow">Carcazas públicas · solo lectura</span>
          <h1 className="ep-serif">Pantallas para<br /><em>revisar.</em></h1>
          <p>Esta vista no cierra tu sesión, no abre el onboarding y no envía datos. Elige una pantalla pública para verla.</p>
          <div className="ep-review-safe"><LockKeyhole size={15} /> Tu universo y tu sesión de ECHO permanecen intactos.</div>
        </section>
        <nav className="ep-review-grid" aria-label="Pantallas públicas para revisar">
          {publicScreens.map((screen) => (
            <Link key={screen.href} href={screen.href} className="ep-review-card">
              <span><strong>{screen.label}</strong><small>{screen.detail}</small></span>
              <ArrowRight size={17} aria-hidden="true" />
            </Link>
          ))}
        </nav>
        <footer className="ep-review-footer">
          <Link href="/" className="ep-text-link"><ArrowLeft size={15} /> Volver a ECHO</Link>
        </footer>
      </div>
    </main>
  );
}

type AuthPreviewKind = 'sign-in' | 'sign-up';

export function AuthScreenPreview({ kind }: { kind: AuthPreviewKind }) {
  const isSignIn = kind === 'sign-in';
  const otherKind = isSignIn ? 'sign-up' : 'sign-in';

  return (
    <main className="echo-public ep-auth-review">
      <div className="ep-auth-review-inner">
        <header className="ep-auth-review-top">
          <Link href="/creator-preview" className="ep-auth-review-brand">ECHO</Link>
          <span className="ep-review-badge"><Eye size={14} /> Vista previa · sin interacción</span>
        </header>
        <section className="ep-auth-preview-card" aria-label={isSignIn ? 'Vista previa de inicio de sesión' : 'Vista previa de registro'}>
          <span className="ep-auth-preview-mark" aria-hidden="true">◎</span>
          <h1>{isSignIn ? 'Te damos la bienvenida' : 'Crea tu espacio privado'}</h1>
          <p>{isSignIn ? 'Inicia sesión para volver a tu universo.' : 'Tus personajes y recuerdos estarán en tu cuenta.'}</p>
          <button type="button" className="ep-auth-google" disabled>Continuar con Google</button>
          <div className="ep-auth-divider"><span>o</span></div>
          <form onSubmit={(event) => event.preventDefault()}>
            <label className="ep-auth-field">
              <span>Correo electrónico</span>
              <input type="email" autoComplete="email" placeholder="Ingresa tu dirección de correo electrónico" disabled />
            </label>
            {!isSignIn && (
              <label className="ep-auth-field">
                <span>Contraseña</span>
                <input type="password" autoComplete="new-password" placeholder="Crea una contraseña" disabled />
              </label>
            )}
            <button type="button" className="ep-auth-submit" disabled>Continuar <span aria-hidden="true">›</span></button>
          </form>
          <p className="ep-auth-switch">
            {isSignIn ? '¿No tienes cuenta?' : '¿Ya tienes una cuenta?'}{' '}
            <Link href={publicPreviewHref(`/${otherKind}`, true)}>{isSignIn ? 'Regístrate' : 'Iniciar sesión'}</Link>
          </p>
          <p className="ep-auth-preview-note">Vista visual únicamente. No se inicia sesión ni se envía información.</p>
        </section>
        <Link href="/creator-preview" className="ep-auth-review-back"><ArrowLeft size={14} /> Volver a las pantallas públicas</Link>
      </div>
    </main>
  );
}
