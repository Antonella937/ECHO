import { Music2 } from 'lucide-react';
import { useState } from 'react';
import { parseYouTubeVideoId, youtubeWatchUrl } from '@/lib/youtube-music';

export function MusicSelectorPreview({ title, artist, onTitleChange, onArtistChange, story }: {
  title: string;
  artist: string;
  onTitleChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  story: boolean;
}) {
  const [youtubeLink, setYoutubeLink] = useState('');
  const videoId = parseYouTubeVideoId(youtubeLink);
  return <section className="rounded-2xl border border-input bg-card px-4 py-3" aria-label="ECHO Music">
    <div className="flex items-center gap-2 text-[11px] uppercase tracking-[0.16em] text-muted-foreground"><Music2 className="h-3.5 w-3.5" /> Música · etiqueta gratuita</div>
    <p className="mt-2 text-xs text-muted-foreground">La etiqueta de canción y artista es gratis para todas las cuentas. No reproduce audio.</p>
    <div className="mt-3 grid grid-cols-2 gap-2">
      <input value={title} onChange={e => onTitleChange(e.target.value.slice(0, 160))} placeholder="Canción" aria-label="Título de la canción" className="h-11 min-w-0 rounded-xl bg-secondary px-3 text-[15px] placeholder:text-muted-foreground focus:outline-none" data-testid="input-music-title" />
      <input value={artist} onChange={e => onArtistChange(e.target.value.slice(0, 160))} placeholder="Artista" aria-label="Artista" className="h-11 min-w-0 rounded-xl bg-secondary px-3 text-[15px] placeholder:text-muted-foreground focus:outline-none" data-testid="input-music-artist" />
    </div>
    <p className="mt-2 text-xs text-muted-foreground">{story ? 'Estos datos se muestran como etiqueta en la historia. No incluyen audio.' : 'La etiqueta en publicaciones está en preparación; todavía no se guarda.'}</p>
    <p className="mt-3 text-xs font-semibold text-primary">ECHO Music add-on · reproducción de fragmentos autorizados y generación con IA (próximamente)</p>
    <div className="mt-3 rounded-xl border border-border bg-secondary/40 p-3">
      <label className="block text-xs font-semibold" htmlFor="echo-youtube-link">YouTube · preparar enlace oficial</label>
      <input id="echo-youtube-link" value={youtubeLink} onChange={e => setYoutubeLink(e.target.value.slice(0, 500))} placeholder="https://www.youtube.com/watch?v=..." className="mt-2 h-11 w-full min-w-0 rounded-lg bg-card px-3 text-sm" />
      {videoId ? <div className="mt-2 space-y-1 text-xs"><p className="text-foreground">Enlace válido · video {videoId}</p><a className="text-primary underline" href={youtubeWatchUrl(videoId)} target="_blank" rel="noopener noreferrer">Abrir en YouTube</a><p className="text-muted-foreground">Todavía no se adjunta ni reproduce dentro de ECHO. La reproducción oficial y los permisos del add-on siguen pendientes.</p></div> : youtubeLink.trim() ? <p className="mt-2 text-xs text-muted-foreground">Ingresá un enlace válido de YouTube.</p> : null}
    </div>
    <div className="mt-3 flex gap-2">
      <span className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">Spotify · pendiente</span>
      <span className="rounded-lg bg-secondary px-3 py-2 text-xs text-muted-foreground">YouTube · pendiente</span>
    </div>
  </section>;
}
