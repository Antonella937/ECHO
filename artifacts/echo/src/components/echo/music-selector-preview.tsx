import { Music2 } from 'lucide-react';
import { useState } from 'react';
import { MusicLibraryPicker } from './music-library-picker';
import { MusicClipPlayer } from './music-clip-player';
import { useSocial } from '@/store/social-store';

type SelectedTrack = { id: string; title: string; characterId: string; durationSeconds: number; startSeconds: number; clipSeconds: 15 | 30 };

export function MusicSelectorPreview({ title, artist, onTitleChange, onArtistChange, story, selectedTrack, onTrackChange }: {
  title: string;
  artist: string;
  onTitleChange: (value: string) => void;
  onArtistChange: (value: string) => void;
  story: boolean;
  selectedTrack?: SelectedTrack | null;
  onTrackChange?: (track: SelectedTrack | null) => void;
}) {
  const { me } = useSocial();
  const [showLibrary, setShowLibrary] = useState(false);
  return <section className="rounded-2xl border border-input bg-card p-4" aria-label="ECHO Music">
    <div className="flex items-center gap-2 text-sm font-semibold"><Music2 className="h-4 w-4 text-primary" /> Música de ECHO</div>
    <button type="button" onClick={() => setShowLibrary(value => !value)}
      className="mt-3 flex h-11 w-full items-center gap-2 rounded-xl border border-border bg-secondary px-3 text-left text-sm">
      <Music2 className="h-4 w-4 text-primary" /> {showLibrary ? 'Cerrar Mi biblioteca' : selectedTrack ? 'Cambiar canción de Mi biblioteca' : 'Elegir de Mi biblioteca'}
    </button>
    {showLibrary && <div className="mt-3"><MusicLibraryPicker onCancel={() => setShowLibrary(false)} onSelect={selection => {
      const clipSeconds: 15 | 30 = selection.clipDurationSeconds === 30 ? 30 : 15;
      onTrackChange?.({ id: selection.id, title: selection.title, characterId: selection.characterId,
        durationSeconds: selection.durationSeconds, startSeconds: selection.clipStartSeconds, clipSeconds });
      onTitleChange(selection.title);
      onArtistChange(me.name);
      setShowLibrary(false);
    }} /></div>}
    {selectedTrack && !showLibrary && <div className="mt-3 space-y-3 rounded-xl border border-border bg-secondary/40 p-3">
      <div className="flex items-center justify-between gap-2">
        <span className="min-w-0 truncate text-sm font-medium">{selectedTrack.title}</span>
        <button type="button" onClick={() => { onTrackChange?.(null); onTitleChange(''); onArtistChange(''); }}
          className="shrink-0 text-xs underline">Quitar</button>
      </div>
      <div className="flex gap-2">{([15, 30] as const).map(seconds =>
        <button key={seconds} type="button" onClick={() => onTrackChange?.({ ...selectedTrack, clipSeconds: seconds,
          startSeconds: Math.min(selectedTrack.startSeconds, Math.max(0, selectedTrack.durationSeconds - seconds)) })}
          className={`rounded-full px-4 py-2 text-sm ${selectedTrack.clipSeconds === seconds ? 'bg-primary text-primary-foreground' : 'bg-card'}`}>{seconds} s</button>)}</div>
      <input aria-label="Inicio del fragmento" type="range" min={0}
        max={Math.max(0, selectedTrack.durationSeconds - selectedTrack.clipSeconds)}
        value={Math.min(selectedTrack.startSeconds, Math.max(0, selectedTrack.durationSeconds - selectedTrack.clipSeconds))}
        step={1} onChange={event => onTrackChange?.({ ...selectedTrack, startSeconds: Number(event.target.value) })}
        className="w-full accent-primary" />
      <p className="text-xs text-muted-foreground">Desde {selectedTrack.startSeconds}s · {selectedTrack.clipSeconds}s</p>
      <MusicClipPlayer clip={{ trackId: selectedTrack.id, title: selectedTrack.title,
        startSeconds: selectedTrack.startSeconds, clipSeconds: selectedTrack.clipSeconds }} libraryPreview />
    </div>}
    <div className="mt-4 grid grid-cols-2 gap-2">
      <label className="text-xs text-muted-foreground">Canción
        <input value={title} onChange={event => onTitleChange(event.target.value.slice(0, 160))}
          placeholder="Nombre de canción" className="mt-1 h-11 w-full min-w-0 rounded-xl bg-secondary px-3 text-sm text-foreground" />
      </label>
      <label className="text-xs text-muted-foreground">Artista
        <input value={artist} onChange={event => onArtistChange(event.target.value.slice(0, 160))}
          placeholder="Nombre del artista" className="mt-1 h-11 w-full min-w-0 rounded-xl bg-secondary px-3 text-sm text-foreground" />
      </label>
    </div>
    {story && !selectedTrack && title.trim() && <p className="mt-2 text-xs text-muted-foreground">Para que se escuche en la historia, adjuntá una canción desde Mi biblioteca.</p>}
  </section>;
}
