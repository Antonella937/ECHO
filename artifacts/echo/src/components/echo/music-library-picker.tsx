import { useEffect, useState } from 'react';
import { Music2, Loader2 } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';

export type MusicLibrarySelection = {
  id: string;
  title: string;
  characterId: string;
  durationSeconds: number;
  clipStartSeconds: number;
  clipDurationSeconds: number | null;
};

type LibraryTrack = {
  id: string;
  title: string;
  characterId: string;
  durationSeconds: number;
  status: 'draft' | 'saved_audio';
  audioPath?: string | null;
};

type Props = {
  onSelect: (track: MusicLibrarySelection) => void;
  onCancel?: () => void;
  storyClip?: boolean;
  characterId?: string;
};

/**
 * Shared ECHO Music selector for post, story and DM composers.
 * Selection is local: it never publishes, sends or spends a credit.
 * The destination composer must still validate and submit its own content.
 */
export function MusicLibraryPicker({ onSelect, onCancel, storyClip = false, characterId }: Props) {
  const [tracks, setTracks] = useState<LibraryTrack[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  const [selected, setSelected] = useState<string | null>(null);
  const [start, setStart] = useState(0);
  const [length, setLength] = useState<15 | 30>(15);

  useEffect(() => {
    let active = true;
    setLoading(true);
    void customFetch<{ items: LibraryTrack[] }>('/api/music/library', { responseType: 'json' })
      .then(result => {
        if (!active) return;
        setTracks(result.items.filter(item => item.status === 'saved_audio' && !!item.audioPath &&
          (!characterId || item.characterId === characterId)));
      })
      .catch(() => { if (active) setError('No se pudo cargar Mi biblioteca.'); })
      .finally(() => { if (active) setLoading(false); });
    return () => { active = false; };
  }, [characterId]);

  const track = tracks.find(item => item.id === selected);
  const maxStart = Math.max(0, (track?.durationSeconds ?? 0) - Math.min(length, track?.durationSeconds ?? 0));
  return (
    <section className="space-y-3 rounded-2xl border border-border bg-card p-4" aria-label="Elegir música de Mi biblioteca">
      <div className="flex items-center gap-2"><Music2 className="h-5 w-5" /><h3 className="font-semibold">Mi biblioteca · ECHO Music</h3></div>
      {loading && <p className="flex items-center gap-2 text-sm"><Loader2 className="h-4 w-4 animate-spin" /> Cargando canciones…</p>}
      {error && <p role="alert" className="text-sm text-destructive">{error}</p>}
      {!loading && !error && tracks.length === 0 && <p className="text-sm text-muted-foreground">Todavía no tenés canciones guardadas.</p>}
      <div className="max-h-56 space-y-2 overflow-y-auto">
        {tracks.map(item => <button key={item.id} type="button"
          onClick={() => { setSelected(item.id); setStart(0); }}
          aria-pressed={selected === item.id}
          className={`w-full rounded-xl border p-3 text-left text-sm ${selected === item.id ? 'border-primary bg-primary/10' : 'border-border'}`}>
          <span className="block truncate font-semibold">{item.title}</span>
          <span className="text-xs text-muted-foreground">{Math.floor(item.durationSeconds / 60)}:{String(item.durationSeconds % 60).padStart(2, '0')}</span>
        </button>)}
      </div>
      {track && storyClip && <div className="space-y-2">
        <p className="text-sm font-medium">Fragmento para la historia</p>
        <div className="flex gap-2">{([15, 30] as const).map(value =>
          <button key={value} type="button" onClick={() => { setLength(value); setStart(0); }}
            aria-pressed={length === value} className="rounded-lg border border-border px-3 py-2 text-sm">{value} s</button>)}</div>
        <input type="range" aria-label="Inicio del fragmento" min={0} max={maxStart} value={Math.min(start, maxStart)}
          onChange={event => setStart(Number(event.target.value))} className="w-full" />
        <p className="text-xs text-muted-foreground">Inicio: {Math.min(start, maxStart)} s</p>
      </div>}
      <div className="flex justify-end gap-2">
        {onCancel && <button type="button" onClick={onCancel} className="rounded-lg border border-border px-4 py-2 text-sm">Cancelar</button>}
        <button type="button" disabled={!track || (storyClip && track.durationSeconds < 1)}
          onClick={() => { if (track) onSelect({ id: track.id, title: track.title, characterId: track.characterId,
            durationSeconds: track.durationSeconds, clipStartSeconds: storyClip ? Math.min(start, maxStart) : 0,
            clipDurationSeconds: storyClip ? Math.min(length, track.durationSeconds) : null }); }}
          className="rounded-lg bg-primary px-4 py-2 text-sm font-semibold text-primary-foreground disabled:opacity-50">Elegir canción</button>
      </div>
    </section>
  );
}
