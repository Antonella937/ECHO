import { useEffect, useRef, useState } from 'react';
import { Pause, Play, Trash2 } from 'lucide-react';
import { formatDuration } from '@/lib/dm-attachments';

export function VoicePreview({ src, durationSeconds, uploading, error, onRetry, onDiscard }: {
  src: string;
  durationSeconds?: number;
  uploading: boolean;
  error?: string;
  onRetry?(): void;
  onDiscard(): void;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [playError, setPlayError] = useState(false);

  useEffect(() => {
    setPlaying(false);
    setPosition(0);
    setDuration(durationSeconds ?? 0);
    setPlayError(false);
  }, [src, durationSeconds]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio) return;
    if (!audio.paused) { audio.pause(); return; }
    try { setPlayError(false); await audio.play(); }
    catch { setPlayError(true); setPlaying(false); }
  };

  return (
    <div className="flex w-[min(80vw,320px)] items-center gap-2 rounded-xl border border-border bg-card px-2 py-2" data-testid="voice-preview">
      <audio
        ref={audioRef}
        src={src}
        preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
        onTimeUpdate={e => setPosition(e.currentTarget.currentTime)}
        onLoadedMetadata={e => {
          const seconds = e.currentTarget.duration;
          if (Number.isFinite(seconds) && seconds > 0) setDuration(seconds);
        }}
        onError={() => setPlayError(true)}
      />
      <button type="button" onClick={() => void toggle()} aria-label={playing ? 'Pausar vista previa' : 'Escuchar vista previa'}
        className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-secondary" data-testid="button-voice-preview-play">
        {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
      </button>
      <div className="min-w-0 flex-1">
        <input type="range" min={0} max={Math.max(duration, 0.1)} step={0.1} value={Math.min(position, Math.max(duration, 0.1))}
          aria-label="Posición de la nota de voz" className="w-full accent-primary"
          onChange={e => { if (audioRef.current) audioRef.current.currentTime = Number(e.target.value); setPosition(Number(e.target.value)); }}
        />
        <div className="flex justify-between text-[11px] text-muted-foreground">
          <span>{formatDuration(position)} / {formatDuration(duration)}</span>
          <span role="status">{error ? 'Error al subir' : playError ? 'No se puede reproducir' : uploading ? 'Subiendo…' : 'Lista para enviar'}</span>
        </div>
      </div>
      {error && onRetry && <button type="button" onClick={onRetry} className="rounded-lg bg-secondary px-2 py-1 text-xs font-semibold" aria-label="Reintentar subida de audio">Reintentar</button>}
      <button type="button" onClick={() => { audioRef.current?.pause(); onDiscard(); }} aria-label="Descartar nota de voz"
        className="tap grid h-9 w-9 shrink-0 place-items-center rounded-full hover:bg-secondary" data-testid="button-discard-voice-preview">
        <Trash2 className="h-4 w-4" />
      </button>
    </div>
  );
}
