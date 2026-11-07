import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import type { MusicClip } from '@/domain/types';

/** Loads only explicitly published tracks; never exposes private storage URLs. */
export function MusicClipPlayer({ clip, compact = false }: { clip: MusicClip; compact?: boolean }) {
  const audio = useRef<HTMLAudioElement>(null);
  const [src, setSrc] = useState('');
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let url = '';
    setSrc(''); setPlaying(false); setError('');
    void customFetch<Blob>('/api/music/published/' + encodeURIComponent(clip.trackId) + '/audio', { responseType: 'blob' })
      .then(blob => {
        if (!active) return;
        if (!blob.type.startsWith('audio/')) throw new Error('Formato de audio no compatible');
        url = URL.createObjectURL(blob);
        setSrc(url);
      }).catch(() => { if (active) setError('Audio no disponible'); });
    return () => { active = false; audio.current?.pause(); if (url) URL.revokeObjectURL(url); };
  }, [clip.trackId]);
  const toggle = async () => {
    if (!audio.current || !src) return;
    if (!audio.current.paused) { audio.current.pause(); return; }
    if (audio.current.currentTime < clip.startSeconds || audio.current.currentTime >= clip.startSeconds + clip.clipSeconds) {
      audio.current.currentTime = clip.startSeconds;
    }
    try { await audio.current.play(); } catch { setError('Tocá de nuevo para reproducir'); }
  };
  return <div className={`flex items-center gap-2 rounded-xl bg-black/65 px-3 py-2 text-white backdrop-blur ${compact ? 'text-xs' : 'text-sm'}`}>
    <Music2 className="h-4 w-4 shrink-0" />
    <span className="min-w-0 flex-1 truncate">{clip.title}</span>
    {error ? <span className="text-xs text-red-200">{error}</span> : <button type="button" disabled={!src} onClick={() => void toggle()} aria-label={playing ? 'Pausar música' : 'Reproducir música'} className="grid h-9 w-9 shrink-0 place-items-center rounded-full bg-white/20 disabled:opacity-40">{playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}</button>}
    <audio ref={audio} src={src || undefined} preload="metadata" onLoadedMetadata={e => { e.currentTarget.currentTime = Math.min(clip.startSeconds, Math.max(0, e.currentTarget.duration - 0.1)); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={e => { if (e.currentTarget.currentTime >= clip.startSeconds + clip.clipSeconds) e.currentTarget.pause(); }} onEnded={() => setPlaying(false)} />
  </div>;
}
