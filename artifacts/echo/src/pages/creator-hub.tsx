import { useUser } from '@clerk/react';
import { ArrowLeft, ExternalLink, LockKeyhole, MessageCircle, ShieldCheck } from 'lucide-react';
import { Link } from 'wouter';

/**
 * Creator Hub is the real account owner's presentation, not a fictional identity.
 * Sharing and access requests intentionally remain disabled until the
 * recipient-scoped authorization API and legal consent are implemented.
 */
export default function CreatorHubPage() {
  const { user } = useUser();
  const alias = user?.fullName?.trim() || user?.firstName?.trim() || user?.username || 'Tu espacio Creator';
  const username = user?.username || user?.primaryEmailAddress?.emailAddress?.split('@')[0] || 'creator';
  const nameParts = alias.split(/\s+/).filter(Boolean);
  const initials = nameParts.length > 1
    ? `${nameParts[0][0]}${nameParts[nameParts.length - 1][0]}`.toUpperCase()
    : (nameParts[0]?.slice(0, 2).toUpperCase() || 'EC');
  return (
    <div className="min-h-[100dvh] bg-background text-foreground">
      <header className="absolute left-0 right-0 top-0 z-20 flex items-center gap-3 px-4 pb-4 pt-safe text-foreground">
        <Link href="/" aria-label="Volver al inicio" className="grid h-11 w-11 place-items-center rounded-full border border-white/20 bg-black/45 backdrop-blur-md hover:bg-black/65"><ArrowLeft size={19} /></Link>
        <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-foreground/70">ECHO</p><h1 className="text-lg font-semibold">Creator Hub</h1></div>
      </header>
      <div className="px-4">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card" aria-label="Perfil Creator Hub">
          <div className="flex h-56 flex-col items-center justify-center gap-2 pt-12 sm:h-72 lg:h-80 bg-[linear-gradient(130deg,hsl(263_18%_19%),hsl(336_15%_16%))] text-muted-foreground">
            <span className="select-none text-[clamp(4rem,14vw,9rem)] font-black tracking-[-0.08em] text-white/20" aria-hidden="true">{initials}</span>
          </div>
          <div className="mx-auto max-w-5xl space-y-7 px-5 py-8 sm:px-10">
            <div className="flex items-center gap-3">
              <span className="grid h-20 w-20 shrink-0 place-items-center rounded-full border-4 border-background bg-secondary text-2xl font-semibold sm:h-28 sm:w-28" aria-label={`Avatar de ${alias}: ${initials}`}>{initials}</span>
              <div className="min-w-0 flex-1"><h2 className="truncate text-2xl font-semibold sm:text-3xl">{alias}</h2><p className="truncate text-sm text-muted-foreground">@{username}</p></div>
              <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">Perfil privado</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">Tu espacio para presentar los mundos, personajes e historias que creás.</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ExternalLink size={16} /><span>Enlace externo opcional</span></div>
            <div className="border-t border-border pt-5">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled title="Las solicitudes de acceso todavía no están habilitadas" className="rounded-full bg-secondary px-3 py-3 text-sm font-semibold text-muted-foreground opacity-70">Solicitar acceso</button>
                <button type="button" disabled title="Los mensajes Creator Hub todavía no están habilitados" className="flex items-center justify-center gap-2 rounded-full border border-border px-3 py-3 text-sm text-muted-foreground opacity-60"><MessageCircle size={16} /> Mensaje privado</button>
              </div>
              <div className="mt-6 rounded-2xl bg-secondary/70 px-5 py-12 text-center sm:py-16">
                <LockKeyhole size={23} className="mx-auto mb-3 text-muted-foreground" />
                <h3 className="font-semibold">Contenido privado</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Los personajes y universos compartidos solo serán visibles después de que el creador autorice el acceso.</p>
              </div>
            </div>
          </div>
        </section>
        <p className="mx-auto mt-6 flex max-w-5xl items-start gap-2 px-6 pb-12 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> Esta es la base visual de Creator Hub. La edición del perfil, las solicitudes y el contenido compartido se habilitarán cuando existan controles de privacidad completos. Ningún universo se publica automáticamente.</p>
      </div>
    </div>
  );
}
