import { useEffect, useRef, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { uploadPrivateVoice, useMediaResolver } from '@/lib/media';

export function HumanVoicePlayback({ objectPath, durationSeconds }: { objectPath: string; durationSeconds: number }) {
  const resolve = useMediaResolver();
  const src = resolve(objectPath);
  return <div className="rounded-2xl bg-secondary/60 px-3 py-2">
    {src ? <audio controls preload="metadata" src={src} className="max-w-full" aria-label="Mensaje de voz" /> :
      <span className="text-xs text-muted-foreground">Cargando audio privado…</span>}
    <p className="text-[10px] text-muted-foreground">{durationSeconds}s · Audio privado</p>
  </div>;
}

export function HumanVoiceRecorder({ targetOwnerId, onSent }: { targetOwnerId: string; onSent: () => Promise<void> }) {
  const [recording, setRecording] = useState(false);
  const [busy, setBusy] = useState(false);
  const [preview, setPreview] = useState<{ blob: Blob; url: string; duration: number } | null>(null);
  const [error, setError] = useState('');
  const recorder = useRef<MediaRecorder | null>(null);
  const started = useRef(0);
  const timer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const chunks = useRef<Blob[]>([]);
  const previewRef = useRef<typeof preview>(null);
  useEffect(() => { previewRef.current = preview; }, [preview]);
  useEffect(() => () => {
    if (timer.current) clearTimeout(timer.current);
    recorder.current?.stop();
    stream.current?.getTracks().forEach(track => track.stop());
    if (previewRef.current) URL.revokeObjectURL(previewRef.current.url);
  }, []);
  async function start() {
    setError('');
    if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined') {
      setError('Este navegador no permite grabar audios.'); return;
    }
    try {
      const media = await navigator.mediaDevices.getUserMedia({ audio: true });
      const mime = ['audio/webm', 'audio/mp4', 'audio/ogg'].find(type => MediaRecorder.isTypeSupported(type));
      if (!mime) { media.getTracks().forEach(t => t.stop()); setError('Formato de grabación no compatible.'); return; }
      const next = new MediaRecorder(media, { mimeType: mime });
      stream.current = media; recorder.current = next; chunks.current = [];
      next.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      next.onstop = () => {
        if (timer.current) clearTimeout(timer.current);
        media.getTracks().forEach(t => t.stop());
        const duration = Math.min(120, Math.max(1, Math.ceil((Date.now() - started.current) / 1000)));
        const blob = new Blob(chunks.current, { type: mime });
        if (blob.size) setPreview({ blob, url: URL.createObjectURL(blob), duration });
        else setError('No se registró sonido. Intentá otra vez.');
        setRecording(false);
      };
      started.current = Date.now(); next.start(250); setRecording(true);
      timer.current = setTimeout(() => { if (next.state === 'recording') next.stop(); }, 120000);
    } catch { setError('No se pudo acceder al micrófono. Revisá los permisos.'); }
  }
  function stop() { if (recorder.current?.state === 'recording') recorder.current.stop(); }
  function discard() { if (preview) URL.revokeObjectURL(preview.url); setPreview(null); }
  async function send() {
    if (!preview || busy) return;
    setBusy(true); setError('');
    try {
      const objectPath = await uploadPrivateVoice(preview.blob);
      await customFetch('/api/creator-hub/social/voice-messages', {
        method: 'POST', responseType: 'json', headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ targetOwnerId, objectPath, durationSeconds: preview.duration }),
      });
      discard(); await onSent();
    } catch { setError('No se pudo enviar el audio. Probá nuevamente.'); }
    finally { setBusy(false); }
  }
  return <div className="space-y-2">
    {preview ? <div className="flex flex-wrap items-center gap-2">
      <audio controls src={preview.url} aria-label="Vista previa del audio" className="max-w-full" />
      <button type="button" disabled={busy} onClick={discard} className="rounded-full border px-3 py-2 text-xs">Descartar</button>
      <button type="button" disabled={busy} onClick={() => void send()} className="rounded-full bg-primary px-3 py-2 text-xs text-primary-foreground">{busy ? 'Enviando…' : 'Enviar audio'}</button>
    </div> : <button type="button" disabled={busy} onClick={() => recording ? stop() : void start()} className="rounded-full border border-border px-3 py-2 text-sm">
      {recording ? '■ Detener grabación' : '🎙️ Grabar audio'}
    </button>}
    {recording && <p role="status" className="text-xs text-muted-foreground">Grabando… máximo 2 minutos.</p>}
    {error && <p role="alert" className="text-xs text-destructive">{error}</p>}
  </div>;
}
