import { useUser } from '@clerk/react';
import { ArrowLeft, ExternalLink, ImagePlus, LockKeyhole, MessageCircle, ShieldCheck, UserRound } from 'lucide-react';
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
  const initials = alias.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part[0]?.toUpperCase()).join('') || 'E';
  const avatar = user?.imageUrl;
  return (
    <div className="min-h-[100dvh] bg-background pb-28 text-foreground">
      <header className="flex items-center gap-3 px-5 py-5">
        <Link href="/settings" aria-label="Volver a ajustes" className="grid h-10 w-10 place-items-center rounded-full border border-border hover:bg-secondary"><ArrowLeft size={19} /></Link>
        <div><p className="text-[10px] font-semibold uppercase tracking-[.2em] text-muted-foreground">ECHO · Creator Hub</p><h1 className="text-xl font-semibold">Tu perfil de creador</h1></div>
      </header>
      <div className="px-4">
        <section className="overflow-hidden rounded-[28px] border border-border bg-card" aria-label="Perfil Creator Hub">
          <div className="flex h-36 flex-col items-center justify-center gap-2 bg-[linear-gradient(130deg,hsl(263_18%_19%),hsl(336_15%_16%))] text-muted-foreground">
            <ImagePlus size={27} strokeWidth={1.5} />
            <span className="text-sm">Banner opcional</span>
          </div>
          <div className="space-y-5 px-5 py-6">
            <div className="flex items-center gap-3">
              {avatar ? <img src={avatar} alt="" className="h-16 w-16 shrink-0 rounded-full object-cover" /> : <span className="grid h-16 w-16 shrink-0 place-items-center rounded-full bg-secondary text-xl font-semibold">{initials}</span>}
              <div className="min-w-0 flex-1"><h2 className="truncate text-lg font-semibold">{alias}</h2><p className="truncate text-sm text-muted-foreground">@{username}</p></div>
              <span className="shrink-0 rounded-full bg-secondary px-3 py-1 text-xs text-muted-foreground">Perfil privado</span>
            </div>
            <p className="text-sm leading-relaxed text-muted-foreground">Tu espacio para presentar los mundos, personajes e historias que creás.</p>
            <div className="flex items-center gap-2 text-sm text-muted-foreground"><ExternalLink size={16} /><span>Enlace externo opcional</span></div>
            <div className="border-t border-border pt-5">
              <div className="grid grid-cols-2 gap-3">
                <button type="button" disabled title="Las solicitudes de acceso todavía no están habilitadas" className="rounded-full bg-secondary px-3 py-3 text-sm font-semibold text-muted-foreground opacity-70">Solicitar acceso</button>
                <button type="button" disabled title="Los mensajes Creator Hub todavía no están habilitados" className="flex items-center justify-center gap-2 rounded-full border border-border px-3 py-3 text-sm text-muted-foreground opacity-60"><MessageCircle size={16} /> Mensaje privado</button>
              </div>
              <div className="mt-4 rounded-2xl bg-secondary/70 px-5 py-7 text-center">
                <LockKeyhole size={23} className="mx-auto mb-3 text-muted-foreground" />
                <h3 className="font-semibold">Contenido privado</h3>
                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">Los personajes y universos compartidos solo serán visibles después de que el creador autorice el acceso.</p>
              </div>
            </div>
          </div>
        </section>
        <p className="mt-5 flex items-start gap-2 px-2 text-xs leading-relaxed text-muted-foreground"><ShieldCheck size={16} className="mt-0.5 shrink-0" /> Esta es la base visual de Creator Hub. La edición del perfil, las solicitudes y el contenido compartido se habilitarán cuando existan controles de privacidad completos. Ningún universo se publica automáticamente.</p>
      </div>
    </div>
  );
}
