import { Music2, Search, Check, ExternalLink } from 'lucide-react';
import { useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { parseYouTubeVideoId, youtubeWatchUrl } from '@/lib/youtube-music';

export function MusicSelectorPreview({ title, artist, onTitleChange, onArtistChange, story, selectedTrack, onTrackChange }: {
  title: string;
  artist: string;
  onTitleChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  story: boolean;
  selectedTrack?: { id: string; title: string; characterId: string; durationSeconds: number; startSeconds: number; clipSeconds: 15 | 30 } | null;
  onTrackChange?: (track: { id: string; title: string; characterId: string; durationSeconds: number; startSeconds: number; clipSeconds: 15 | 30 } | null) => void;
}) {
  const [youtubeLink, setYoutubeLink] = useState('');
  const [sharedTracks, setSharedTracks] = useState<Array<{ id: string; title: string; characterId: string; durationSeconds: number }>>([]);
  const [libraryError, setLibraryError] = useState('');
  useEffect(() => { let active = true; void customFetch<{ items: typeof sharedTracks }>('/api/music/published', { responseType: 'json' }).then(data => { if (active) setSharedTracks(data.items); }).catch(() => { if (active) setLibraryError('No se pudo cargar el catálogo de ECHO Music.'); }); return () => { active = false; }; }, []);
  const [showSearch, setShowSearch] = useState(false);
  const [showPlayer, setShowPlayer] = useState(false);
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
    setShowPlayer(false);
  };
  const partial = Boolean(title.trim()) !== Boolean(artist.trim());
  return <section className="rounded-2xl border border-input bg-card p-4" aria-label="ECHO Music">
    <div className="flex items-center gap-2 text-sm font-semibold"><Music2 className="h-4 w-4 text-primary" /> Música</div>
    <p className="mt-1 text-xs text-muted-foreground">Elegí una canción compartida en ECHO para preparar un fragmento de audio, o agregá una etiqueta musical.</p>
    <div className="mt-3 rounded-xl border border-border bg-secondary/50 p-3">
      <p className="text-xs font-semibold">Canciones compartidas en ECHO</p>
      {libraryError && <p className="mt-2 text-xs text-destructive">{libraryError}</p>}
      {sharedTracks.length === 0 ? <p className="mt-2 text-xs text-muted-foreground">Todavía no hay canciones compartidas.</p> : <select className="mt-2 h-11 w-full rounded-xl bg-card px-3 text-sm" value={selectedTrack?.id ?? ''} onChange={e => { const track = sharedTracks.find(item => item.id === e.target.value); onTrackChange?.(track ? { ...track, startSeconds: 0, clipSeconds: 15 } : null); if (track) { onTitleChange(track.title); onArtistChange('ECHO Music'); } }} aria-label="Seleccionar canción de ECHO Music"><option value="">Sin canción de ECHO Music</option>{sharedTracks.map(item => <option key={item.id} value={item.id}>{item.title}</option>)}</select>}
      {selectedTrack && <div className="mt-3 space-y-2"><div className="flex gap-2">{([15,30] as const).map(seconds => <button key={seconds} type="button" className={`rounded-full px-3 py-2 text-xs ${selectedTrack.clipSeconds === seconds ? 'bg-primary text-primary-foreground' : 'bg-card'}`} onClick={() => onTrackChange?.({ ...selectedTrack, clipSeconds: seconds, startSeconds: Math.min(selectedTrack.startSeconds, Math.max(0, selectedTrack.durationSeconds - seconds)) })}>{seconds} s</button>)}</div><input aria-label="Inicio del fragmento musical" type="range" min={0} max={Math.max(0, selectedTrack.durationSeconds - selectedTrack.clipSeconds)} value={selectedTrack.startSeconds} step={1} onChange={e => onTrackChange?.({ ...selectedTrack, startSeconds: Number(e.target.value) })} className="w-full accent-primary"/><p className="text-xs text-muted-foreground">Desde {selectedTrack.startSeconds}s · {selectedTrack.clipSeconds}s de música</p><button type="button" onClick={() => onTrackChange?.(null)} className="text-xs underline">Quitar selección</button></div>}
      <p className="mt-2 text-xs text-muted-foreground">La selección es una vista previa: todavía no se adjunta a la publicación.</p>
    </div>
    <button type="button" onClick={() => setShowSearch(v => !v)} className="mt-3 flex h-11 w-full items-center gap-2 rounded-xl border border-border bg-secondary px-3 text-left text-sm" aria-expanded={showSearch}>
      <Search className="h-4 w-4 text-primary" /> {showSearch ? 'Cerrar búsqueda' : 'Buscar canción en YouTube'}
    </button>
    {showSearch && <div className="mt-3 rounded-xl border border-border p-3">
      <div className="flex gap-2">
        <input value={searchQuery} maxLength={100} onChange={e => setSearchQuery(e.target.value)} placeholder="Canción o artista" aria-label="Buscar canción en YouTube" onKeyDown={e => { if (e.key === "Enter") { e.preventDefault(); e.stopPropagation(); void searchYouTube(); } }} className="h-11 min-w-0 flex-1 rounded-lg bg-secondary px-3 text-sm" />
        <button type="button" onClick={() => void searchYouTube()} disabled={searching || searchQuery.trim().length < 3} className="rounded-lg bg-primary px-3 text-sm font-semibold text-primary-foreground disabled:opacity-50">{searching ? 'Buscando…' : 'Buscar'}</button>
      </div>
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
    {videoId && <div className="mt-3 rounded-xl border border-border p-3">
      <p className="text-xs font-semibold">Vista previa · reproductor oficial de YouTube</p>
      <p className="mt-1 text-xs text-muted-foreground">Reproduce el video desde YouTube; no extrae audio ni agrega un fragmento a la historia publicada.</p>
      <button type="button" onClick={() => setShowPlayer(v => !v)} className="mt-2 h-10 rounded-lg bg-secondary px-3 text-xs font-semibold">{showPlayer ? 'Cerrar reproductor' : 'Escuchar en YouTube'}</button>
      {showPlayer && <div className="mt-3 aspect-video overflow-hidden rounded-lg bg-black"><iframe title={'Reproductor oficial de ' + title} src={'https://www.youtube-nocookie.com/embed/' + videoId + '?playsinline=1'} className="h-full w-full" allow="accelerometer; autoplay; encrypted-media; gyroscope; picture-in-picture; web-share" referrerPolicy="strict-origin-when-cross-origin" allowFullScreen /></div>}
    </div>}
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
