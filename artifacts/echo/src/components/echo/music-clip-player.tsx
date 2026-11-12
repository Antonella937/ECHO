import { useEffect, useRef, useState } from 'react';
import { Music2, Pause, Play } from 'lucide-react';
import { customFetch } from '@workspace/api-client-react';
import type { MusicClip } from '@/domain/types';

/** Streams authorized library clips without exposing private storage URLs. */
export function MusicClipPlayer({ clip, compact = false, autoPlay = false, source, libraryPreview = false, artist }: { clip: MusicClip; compact?: boolean; autoPlay?: boolean; libraryPreview?: boolean; artist?: string; source?: { universeId: string; surface: 'post' | 'story'; contentId: string; viewerUniverseId?: string; viewerCharacterId?: string } }) {
  const audio = useRef<HTMLAudioElement>(null);
  const container = useRef<HTMLDivElement>(null);
  const [src, setSrc] = useState('');
  const [playing, setPlaying] = useState(false);
  const [error, setError] = useState('');
  useEffect(() => {
    let active = true;
    let url = '';
    setSrc(''); setPlaying(false); setError('');
    const params = source ? new URLSearchParams(Object.entries(source).filter((entry): entry is [string, string] => typeof entry[1] === 'string')) : null;
    const endpoint = source ? '/api/music/clip/' + encodeURIComponent(clip.trackId) + '/audio?' + params!.toString() : libraryPreview ? '/api/music/generation/' + encodeURIComponent(clip.trackId) + '/audio' : '/api/music/published/' + encodeURIComponent(clip.trackId) + '/audio';
    void customFetch<Blob>(endpoint, { responseType: 'blob' })
      .then(blob => {
        if (!active) return;
        if (!blob.type.startsWith('audio/')) throw new Error('Formato de audio no compatible');
        url = URL.createObjectURL(blob);
        setSrc(url);
      }).catch(() => { if (active) setError('Audio no disponible'); });
    return () => { active = false; audio.current?.pause(); if (url) URL.revokeObjectURL(url); };
  }, [clip.trackId, libraryPreview, source?.universeId, source?.surface, source?.contentId, source?.viewerUniverseId, source?.viewerCharacterId]);
  useEffect(() => {
    if (!audio.current || !src) return;
    audio.current.pause();
    audio.current.currentTime = Math.min(clip.startSeconds, Math.max(0, (audio.current.duration || clip.startSeconds + clip.clipSeconds) - 0.1));
  }, [src, clip.startSeconds, clip.clipSeconds]);
  useEffect(() => {
    if (!autoPlay || !src || !audio.current) return;
    const element = audio.current;
    const containerElement = container.current;
    if (!containerElement) return;
    let visible = false;
    const observer = new IntersectionObserver(entries => {
      const inView = entries[0]?.isIntersecting && entries[0].intersectionRatio >= 0.6;
      if (!inView) { visible = false; element.pause(); return; }
      if (!visible) {
        visible = true;
        element.currentTime = clip.startSeconds;
        void element.play().catch(() => { /* Browser requires user gesture; play button remains available. */ });
      }
    }, { threshold: [0, 0.6, 1] });
    observer.observe(containerElement);
    return () => { observer.disconnect(); element.pause(); };
  }, [autoPlay, src, clip.startSeconds]);
  const toggle = async () => {
    if (!audio.current || !src) return;
    if (!audio.current.paused) { audio.current.pause(); return; }
    if (audio.current.currentTime < clip.startSeconds || audio.current.currentTime >= clip.startSeconds + clip.clipSeconds) {
      audio.current.currentTime = clip.startSeconds;
    }
    try { await audio.current.play(); } catch { setError('Tocá de nuevo para reproducir'); }
  };
  return <div ref={container} className={`flex min-w-0 items-center gap-2 text-white ${compact ? 'rounded-full bg-black/55 px-3 py-1.5 backdrop-blur-md' : 'rounded-xl bg-black/65 px-3 py-2 text-sm backdrop-blur'}`}>
    <Music2 className="h-3.5 w-3.5 shrink-0 opacity-80" />
    <span className="min-w-0 flex-1 leading-tight">
      <span className="block truncate text-[11px] font-semibold">{clip.title}</span>
      {artist && <span className="block truncate text-[10px] text-white/70">{artist}</span>}
    </span>
    {error ? <span className="max-w-20 text-[10px] text-red-200">{error}</span> : <button type="button" disabled={!src} onClick={() => void toggle()} aria-label={playing ? 'Pausar música' : 'Reproducir música'} className="grid h-7 w-7 shrink-0 place-items-center rounded-full bg-white/15 disabled:opacity-40">{playing ? <Pause className="h-3.5 w-3.5" /> : <Play className="h-3.5 w-3.5" />}</button>}
    <audio ref={audio} src={src || undefined} preload="metadata" onLoadedMetadata={e => { e.currentTarget.currentTime = Math.min(clip.startSeconds, Math.max(0, e.currentTarget.duration - 0.1)); }} onPlay={() => setPlaying(true)} onPause={() => setPlaying(false)} onTimeUpdate={e => { if (e.currentTarget.currentTime >= clip.startSeconds + clip.clipSeconds) e.currentTarget.pause(); }} onEnded={() => setPlaying(false)} />
  </div>;
}
