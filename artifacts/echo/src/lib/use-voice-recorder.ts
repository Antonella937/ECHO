import { useCallback, useEffect, useRef, useState } from 'react';
import { MAX_RECORDING_MS, recorderSupport } from './dm-attachments';

export type RecorderStatus = 'idle' | 'requesting' | 'recording';

/** Explicit-click voice recorder. Cleans every track/timer on stop, cancel and unmount. */
export function useVoiceRecorder(onDone: (blob: Blob, seconds: number) => void, onError: (msg: string) => void) {
  const [status, setStatus] = useState<RecorderStatus>('idle');
  const [elapsed, setElapsed] = useState(0);
  const rec = useRef<MediaRecorder | null>(null);
  const stream = useRef<MediaStream | null>(null);
  const timers = useRef<number[]>([]);
  const chunks = useRef<Blob[]>([]);
  const started = useRef(0);
  const cancelled = useRef(false);
  const generation = useRef(0);
  const mounted = useRef(true);
  const requesting = useRef(false);
  const stopping = useRef(false);
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const errRef = useRef(onError); errRef.current = onError;

  const cleanup = useCallback(() => {
    timers.current.forEach(t => { window.clearInterval(t); window.clearTimeout(t); });
    timers.current = [];
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    rec.current = null;
    requesting.current = false;
    stopping.current = false;
    setElapsed(0);
    setStatus('idle');
  }, []);

  const stop = useCallback(() => {
    if (requesting.current && !rec.current) {
      generation.current += 1;
      cleanup();
      return;
    }
    if (rec.current && rec.current.state !== 'inactive' && !stopping.current) {
      stopping.current = true;
      try { rec.current.stop(); } catch { cleanup(); errRef.current('No se pudo finalizar la grabación.'); }
    }
  }, [cleanup]);

  const cancel = useCallback(() => { generation.current += 1; cancelled.current = true; chunks.current = []; stop(); }, [stop]);

  const start = useCallback(async () => {
    if (rec.current || stream.current || requesting.current) return;
    const requestId = ++generation.current;
    const sup = recorderSupport();
    if (!sup.ok) { errRef.current(sup.reason); return; }
    requesting.current = true;
    setStatus('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      if (!mounted.current || requestId !== generation.current) {
        s.getTracks().forEach(track => track.stop());
        return;
      }
      requesting.current = false;
      stream.current = s;
      const r = new MediaRecorder(s, { mimeType: sup.mimeType });
      rec.current = r; chunks.current = []; cancelled.current = false;
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onerror = () => {
        cancelled.current = true;
        errRef.current('La grabación falló.');
        if (r.state !== 'inactive') { try { r.stop(); } catch { cleanup(); } }
        else cleanup();
      };
      r.onstop = () => {
        const secs = (Date.now() - started.current) / 1000;
        const blob = new Blob(chunks.current, { type: (r.mimeType || sup.mimeType).split(';')[0] });
        const keep = !cancelled.current && blob.size > 0;
        chunks.current = [];
        cleanup();
        if (keep && mounted.current) doneRef.current(blob, secs);
        else if (!cancelled.current && mounted.current) errRef.current('No se capturó audio. Intentá grabar nuevamente.');
      };
      r.start(250);
      started.current = Date.now();
      setStatus('recording');
      timers.current.push(window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250));
      timers.current.push(window.setTimeout(() => { if (r.state !== 'inactive') r.stop(); }, MAX_RECORDING_MS));
    } catch (e) {
      if (!mounted.current || requestId !== generation.current) return;
      cleanup();
      const name = (e as DOMException)?.name;
      errRef.current(name === 'NotAllowedError' || name === 'PermissionDeniedError' || name === 'SecurityError' ? 'Permiso de micrófono denegado. Habilitalo en los ajustes del navegador y volvé a intentar.'
        : name === 'NotFoundError' || name === 'DevicesNotFoundError' ? 'No se encontró ningún micrófono conectado.'
        : name === 'NotReadableError' || name === 'TrackStartError' ? 'No se pudo acceder al micrófono. Cerrá otras aplicaciones que lo estén usando e intentá de nuevo.'
        : name === 'OverconstrainedError' ? 'El micrófono no admite la configuración solicitada.'
        : name === 'AbortError' ? 'Se interrumpió el acceso al micrófono. Intentá nuevamente.'
        : 'No se pudo iniciar la grabación. Revisá el micrófono y volvé a intentar.');
    }
  }, [cleanup]);

  useEffect(() => () => {
    mounted.current = false;
    generation.current += 1;
    requesting.current = false;
    cancelled.current = true;
    if (rec.current && rec.current.state !== 'inactive') { rec.current.onstop = null; rec.current.stop(); }
    timers.current.forEach(t => { window.clearInterval(t); window.clearTimeout(t); });
    stream.current?.getTracks().forEach(t => t.stop());
  }, []);

  return { status, elapsed, start, stop, cancel };
}
