import { Music2, ExternalLink } from 'lucide-react';

/** Provider authorization must be implemented server-side before connecting accounts. */
export function MusicConnectionsSection() {
  return (
    <section className="mt-9" aria-labelledby="music-connections-h">
      <h2 id="music-connections-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Conexiones musicales</h2>
      <p className="mt-2 px-1 text-xs text-muted-foreground">Vinculá servicios de música para compartir enlaces y contenido autorizado. Conectar una cuenta no habilita la reproducción de fragmentos protegidos en ECHO.</p>
      <div className="mt-3 overflow-hidden rounded-2xl border border-border bg-card/60">
        {(['Spotify', 'YouTube'] as const).map(provider => (
          <div key={provider} className="flex min-h-16 items-center justify-between gap-3 border-b border-border/60 px-4 last:border-b-0">
            <span className="flex items-center gap-2 text-sm font-semibold"><Music2 className="h-4 w-4 text-primary" />{provider}</span>
            <span className="rounded-full bg-secondary px-3 py-1.5 text-xs text-muted-foreground">Conexión próximamente</span>
          </div>
        ))}
      </div>
      <p className="mt-2 px-1 text-xs text-muted-foreground">Nunca ingreses tu contraseña de Spotify o Google en ECHO. La conexión futura usará la autorización oficial de cada servicio.</p>
    </section>
  );
}
