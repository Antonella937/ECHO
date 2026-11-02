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
  const doneRef = useRef(onDone); doneRef.current = onDone;
  const errRef = useRef(onError); errRef.current = onError;

  const cleanup = useCallback(() => {
    timers.current.forEach(t => { window.clearInterval(t); window.clearTimeout(t); });
    timers.current = [];
    stream.current?.getTracks().forEach(t => t.stop());
    stream.current = null;
    rec.current = null;
    setElapsed(0);
    setStatus('idle');
  }, []);

  const stop = useCallback(() => {
    if (rec.current && rec.current.state !== 'inactive') rec.current.stop(); else cleanup();
  }, [cleanup]);

  const cancel = useCallback(() => { cancelled.current = true; chunks.current = []; stop(); }, [stop]);

  const start = useCallback(async () => {
    const sup = recorderSupport();
    if (!sup.ok) { errRef.current(sup.reason); return; }
    setStatus('requesting');
    try {
      const s = await navigator.mediaDevices.getUserMedia({ audio: true });
      stream.current = s;
      const r = new MediaRecorder(s, { mimeType: sup.mimeType });
      rec.current = r; chunks.current = []; cancelled.current = false;
      r.ondataavailable = e => { if (e.data.size) chunks.current.push(e.data); };
      r.onerror = () => { cancelled.current = true; errRef.current('La grabación falló.'); cleanup(); };
      r.onstop = () => {
        const secs = (Date.now() - started.current) / 1000;
        const blob = new Blob(chunks.current, { type: (r.mimeType || sup.mimeType).split(';')[0] });
        const keep = !cancelled.current && blob.size > 0;
        chunks.current = [];
        cleanup();
        if (keep) doneRef.current(blob, secs);
      };
      r.start(250);
      started.current = Date.now();
      setStatus('recording');
      timers.current.push(window.setInterval(() => setElapsed((Date.now() - started.current) / 1000), 250));
      timers.current.push(window.setTimeout(() => { if (r.state !== 'inactive') r.stop(); }, MAX_RECORDING_MS));
    } catch (e) {
      cleanup();
      const name = (e as DOMException)?.name;
      errRef.current(name === 'NotAllowedError' || name === 'SecurityError' ? 'Permiso de micrófono denegado. Activalo en los ajustes del navegador.'
        : name === 'NotFoundError' ? 'No se encontró ningún micrófono.' : 'No se pudo iniciar la grabación.');
    }
  }, [cleanup]);

  useEffect(() => () => {
    cancelled.current = true;
    if (rec.current && rec.current.state !== 'inactive') { rec.current.onstop = null; rec.current.stop(); }
    timers.current.forEach(t => { window.clearInterval(t); window.clearTimeout(t); });
    stream.current?.getTracks().forEach(t => t.stop());
  }, []);

  return { status, elapsed, start, stop, cancel };
}
