import { useEffect, useRef, useState } from 'react';
import { Pause, Play } from 'lucide-react';
import { formatDuration } from '@/lib/dm-attachments';
import { cn } from '@/lib/utils';

const SPEEDS = [1, 1.5, 2] as const;
const AUDIO_PLAY_EVENT = 'echo:audio-message-play';

/** Browser-native audio playback; the source is resolved through authenticated private media. */
export function AudioMessagePlayer({ src, mine, durationSeconds, attachmentId }: {
  src: string;
  mine: boolean;
  durationSeconds?: number;
  attachmentId: string;
}) {
  const audioRef = useRef<HTMLAudioElement>(null);
  const [playing, setPlaying] = useState(false);
  const [position, setPosition] = useState(0);
  const [duration, setDuration] = useState(durationSeconds ?? 0);
  const [speed, setSpeed] = useState<number>(1);
  const [error, setError] = useState(false);
  const playerId = useRef(crypto.randomUUID());

  useEffect(() => {
    const pauseOther = (event: Event) => {
      if ((event as CustomEvent<string>).detail !== playerId.current) audioRef.current?.pause();
    };
    window.addEventListener(AUDIO_PLAY_EVENT, pauseOther);
    return () => { audioRef.current?.pause(); window.removeEventListener(AUDIO_PLAY_EVENT, pauseOther); };
  }, []);

  useEffect(() => {
    const audio = audioRef.current;
    audio?.pause();
    if (audio) { audio.currentTime = 0; audio.playbackRate = 1; }
    setPlaying(false);
    setPosition(0);
    setDuration(durationSeconds ?? 0);
    setSpeed(1);
    setError(false);
  }, [src, durationSeconds]);

  const toggle = async () => {
    const audio = audioRef.current;
    if (!audio || !src) return;
    if (!audio.paused) { audio.pause(); return; }
    try {
      setError(false);
      window.dispatchEvent(new CustomEvent(AUDIO_PLAY_EVENT, { detail: playerId.current }));
      await audio.play();
    }
    catch { setError(true); setPlaying(false); }
  };

  const cycleSpeed = () => {
    const next = SPEEDS[(SPEEDS.indexOf(speed as typeof SPEEDS[number]) + 1) % SPEEDS.length];
    if (audioRef.current) audioRef.current.playbackRate = next;
    setSpeed(next);
  };

  return (
    <div className={cn('flex w-64 max-w-full flex-col gap-1 rounded-2xl border border-border px-3 py-2', mine ? 'bg-primary/10' : 'bg-secondary')}
      data-testid={`audio-attachment-${attachmentId}`}>
      <audio ref={audioRef} src={src || undefined} preload="metadata"
        onPlay={() => setPlaying(true)}
        onPause={() => setPlaying(false)}
        onEnded={() => { setPlaying(false); setPosition(0); }}
        onTimeUpdate={event => setPosition(event.currentTarget.currentTime)}
        onLoadedMetadata={event => {
          const value = event.currentTarget.duration;
          if (Number.isFinite(value) && value > 0) setDuration(value);
        }}
        onError={() => { if (src) setError(true); }}
      />
      <div className="flex items-center gap-2">
        <button type="button" disabled={!src} onClick={() => void toggle()}
          aria-label={playing ? 'Pausar audio' : 'Reproducir audio'}
          className="tap grid h-10 w-10 shrink-0 place-items-center rounded-full bg-background/80 disabled:opacity-40"
          data-testid={`button-audio-play-${attachmentId}`}>
          {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current" />}
        </button>
        <div className="min-w-0 flex-1">
          <input type="range" min={0} max={Math.max(duration, 0.1)} step={0.1}
            value={Math.min(position, Math.max(duration, 0.1))}
            disabled={!src || !duration}
            onChange={event => {
              const next = Number(event.target.value);
              if (audioRef.current) audioRef.current.currentTime = next;
              setPosition(next);
            }}
            aria-label="Avanzar o retroceder audio" className="w-full accent-primary"
          />
          <span className="text-[11px] text-muted-foreground">{formatDuration(position)} / {formatDuration(duration)}</span>
        </div>
        <button type="button" onClick={cycleSpeed} aria-label={`Velocidad de reproducción: ${speed}x. Cambiar velocidad`}
          className="tap min-w-10 rounded-full bg-background/80 px-2 py-1 text-xs font-semibold"
          data-testid={`button-audio-speed-${attachmentId}`}>{speed}×</button>
      </div>
      {error && <p role="alert" className="text-xs text-destructive">No se pudo reproducir el audio. Intentá nuevamente.</p>}
      {!src && !error && <p role="status" className="text-xs text-muted-foreground">Cargando audio…</p>}
    </div>
  );
}
