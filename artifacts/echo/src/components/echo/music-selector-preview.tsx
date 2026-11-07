import { Music2, Search, Check, ExternalLink } from 'lucide-react';
import { useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { parseYouTubeVideoId, youtubeWatchUrl } from '@/lib/youtube-music';

export function MusicSelectorPreview({ title, artist, onTitleChange, onArtistChange, story }: {
  title: string;
  artist: string;
  onTitleChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  story: boolean;
}) {
  const [youtubeLink, setYoutubeLink] = useState('');
  const [showSearch, setShowSearch] = useState(false);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  const [results, setResults] = useState<Array<{ videoId: string; title: string; artist: string; thumbnailUrl?: string | null; watchUrl: string }>>([]);
  async function searchYouTube() {
    if (searchQuery.trim().length < 3 || searching) return;
    setSearching(true); setSearchError(''); setResults([]);
    try {
      const data = await customFetch<{ items: Array<{ videoId: string; title: string; artist: string; thumbnailUrl?: string | null; watchUrl: string }> }>('/api/music/youtube/search?q=' + encodeURIComponent(searchQuery.trim()), { responseType: 'json' });
      setResults(data.items);
    } catch { setSearchError('La búsqueda de YouTube no está disponible todavía. Revisá la configuración del servidor.'); }
    finally { setSearching(false); }
  }
  const videoId = parseYouTubeVideoId(youtubeLink);
  const normalizeArtist = (channel: string) => channel.replace(/\s*[-–]\s*Topic$/i, '').replace(/VEVO$/i, '').trim() || channel;
  const selectResult = (item: { title: string; artist: string; watchUrl: string }) => {
    onTitleChange(item.title.replace(/\\s*\\((?:Official (?:Music )?Video|Official Audio|Lyric Video|Lyrics|Audio)\\)/gi, '').trim().slice(0, 160));
    onArtistChange(normalizeArtist(item.artist).slice(0, 160));
    setYoutubeLink(item.watchUrl);
    setShowSearch(false);
  };
  const partial = Boolean(title.trim()) !== Boolean(artist.trim());
  return <section className="rounded-2xl border border-input bg-card p-4" aria-label="ECHO Music">
    <div className="flex items-center gap-2 text-sm font-semibold"><Music2 className="h-4 w-4 text-primary" /> Música</div>
    <p className="mt-1 text-xs text-muted-foreground">Agregá una etiqueta musical gratis. Por ahora no incluye audio.</p>
    <button type="button" onClick={() => setShowSearch(v => !v)} className="mt-3 flex h-11 w-full items-center gap-2 rounded-xl border border-border bg-secondary px-3 text-left text-sm" aria-expanded={showSearch}>
      <Search className="h-4 w-4 text-primary" /> {showSearch ? 'Cerrar búsqueda' : 'Buscar canción en YouTube'}
    </button>
    {showSearch && <div className="mt-3 rounded-xl border border-border p-3">
      <form onSubmit={e => { e.preventDefault(); void searchYouTube(); }} className="flex gap-2">
        <input value={searchQuery} maxLength={100} onChange={e => setSearchQuery(e.target.value)} placeholder="Canción o artista" aria-label="Buscar canción en YouTube" className="h-11 min-w-0 flex-1 rounded-lg bg-secondary px-3 text-sm" />
        <button type="submit" disabled={searching || searchQuery.trim().length < 3} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{searching ? 'Buscando…' : 'Buscar'}</button>
      </form>
      {searchError && <p role="alert" className="mt-2 text-xs text-destructive">{searchError}</p>}
      {results.length > 0 && <ul className="mt-3 max-h-72 space-y-1 overflow-y-auto">{results.map(item => <li key={item.videoId} className="flex items-center gap-3 rounded-lg p-2 hover:bg-secondary">
        {item.thumbnailUrl && <img src={item.thumbnailUrl} alt="" loading="lazy" className="h-12 w-16 shrink-0 rounded-md object-cover" />}
        <div className="min-w-0 flex-1"><div className="truncate text-xs font-semibold">{item.title}</div><div className="truncate text-xs text-muted-foreground">{normalizeArtist(item.artist)}</div></div>
        <button type="button" onClick={() => selectResult(item)} className="shrink-0 rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground">Elegir</button>
        <a href={item.watchUrl} target="_blank" rel="noopener noreferrer" aria-label={'Abrir ' + item.title + ' en YouTube'}><ExternalLink className="h-4 w-4 text-muted-foreground" /></a>
      </li>)}</ul>}
    </div>}
    <div className="mt-3 grid grid-cols-2 gap-2">
      <input value={title} onChange={e => onTitleChange(e.target.value.slice(0, 160))} placeholder="Canción" aria-label="Título de la canción" className="h-11 min-w-0 rounded-xl bg-secondary px-3 text-sm" data-testid="input-music-title" />
      <input value={artist} onChange={e => onArtistChange(e.target.value.slice(0, 160))} placeholder="Artista" aria-label="Artista" className="h-11 min-w-0 rounded-xl bg-secondary px-3 text-sm" data-testid="input-music-artist" />
    </div>
    {partial && <p role="status" className="mt-2 text-xs text-primary">Completá canción y artista para poder publicar, o borrá ambos campos.</p>}
    {title.trim() && artist.trim() && <p className="mt-2 flex items-center gap-1 text-xs text-muted-foreground"><Check className="h-3.5 w-3.5 text-primary" /> Etiqueta lista: {artist} — {title}</p>}
    {!story && <p className="mt-2 text-xs text-muted-foreground">Las etiquetas de música para publicaciones todavía no se guardan.</p>}
    <details className="mt-3 border-t border-border pt-3 text-xs text-muted-foreground">
      <summary className="cursor-pointer">Enlace oficial y conexiones</summary>
      <label className="mt-3 block" htmlFor="echo-youtube-link">Enlace de YouTube (opcional)</label>
      <input id="echo-youtube-link" value={youtubeLink} onChange={e => setYoutubeLink(e.target.value.slice(0, 500))} placeholder="https://www.youtube.com/watch?v=..." className="mt-2 h-11 w-full min-w-0 rounded-lg bg-secondary px-3 text-sm" />
      {videoId ? <a className="mt-2 block text-primary underline" href={youtubeWatchUrl(videoId)} target="_blank" rel="noopener noreferrer">Abrir video en YouTube</a> : youtubeLink.trim() ? <p className="mt-2">Ingresá un enlace válido de YouTube.</p> : null}
      <p className="mt-3">Buscador YouTube: conectado · Cuenta YouTube: sin vincular · Spotify: pendiente.</p>
    </details>
    <p className="mt-3 text-xs text-muted-foreground">ECHO Music add-on: reproducción autorizada y generación con IA, próximamente.</p>
  </section>;
}
