import { Music2 } from 'lucide-react';

export function MusicSelectorPreview({ title, artist, onTitleChange, onArtistChange, story }: {
  title: string;
  artist: string;
  onTitleChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  story: boolean;
}) {
  return <section className="rounded-2xl border border-input bg-card px-4 py-3" aria-label="ECHO Music">
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"><Music2 className="h-3.5 w-3.5" /> ECHO Music · selector en preparación</div>
    <p className="mt-2 text-xs text-muted-foreground">Spotify y YouTube todavía no están conectados. No se pueden seleccionar ni reproducir fragmentos comerciales.</p>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <input value={title} onChange={e => onTitleChange(e.target.value.slice(0, 160))} placeholder="Canción" aria-label="Título de la canción" className="h-11 min-w-0 rounded-xl bg-secondary px-3 text-[15px] placeholder:text-muted-foreground focus:outline-none" data-testid="input-music-title" />
      <input value={artist} onChange={e => onArtistChange(e.target.value.slice(0, 160))} placeholder="Artista" aria-label="Artista" className="h-11 min-w-0 rounded-xl bg-secondary px-3 text-[15px] placeholder:text-muted-foreground focus:outline-none" data-testid="input-music-artist" />
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{story ? 'Estos datos se muestran como etiqueta en la historia. No incluyen audio.' : 'Vista previa solamente: las publicaciones todavía no guardan esta etiqueta musical.'}</p>
    <div className="mt-3 flex gap-2">
      <span className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">Spotify · pendiente</span>
      <span className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">YouTube · pendiente</span>
    </div>
  </section>;
}
