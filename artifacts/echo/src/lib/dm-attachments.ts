import * as media from '@/lib/media';
import type { MessageAttachment } from '@/domain/types';

export const MAX_ATTACHMENTS = 5;
export const MAX_FILE_BYTES = 50 * 1024 * 1024;
export const MAX_AUDIO_BYTES = 15 * 1024 * 1024;
export const MAX_RECORDING_MS = 120_000;

export type AttachmentKind = MessageAttachment['type'];

export function kindOf(mime: string): AttachmentKind | null {
  if (mime.startsWith('image/')) return 'image';
  if (/^video\/(mp4|webm)/.test(mime)) return 'video';
  if (/^audio\/(webm|ogg|mp4|mpeg|mp3|wav|x-wav|wave|aac|x-m4a)/.test(mime)) return 'audio';
  return null;
}

/** Validates a batch against the existing count. Throws a user-facing Spanish message. */
export function validateAttachments(files: { type: string; size: number }[], existing = 0): void {
  if (existing + files.length > MAX_ATTACHMENTS) throw new Error(`Podés adjuntar hasta ${MAX_ATTACHMENTS} archivos por mensaje.`);
  for (const f of files) {
    const k = kindOf(f.type);
    if (!k) throw new Error('Formato no admitido. Usá fotos, video MP4/WebM o audio WebM/Ogg/MP4/MP3/WAV.');
    if (f.size > MAX_FILE_BYTES) throw new Error('Cada archivo puede pesar hasta 50 MB.');
    if (k === 'audio' && f.size > MAX_AUDIO_BYTES) throw new Error('Los audios pueden pesar hasta 15 MB.');
  }
}

type Uploader = (file: File | Blob) => Promise<MessageAttachment>;
export async function uploadAttachment(file: File | Blob): Promise<MessageAttachment> {
  validateAttachments([file]);
  const fn = (media as unknown as { uploadPrivateFile?: Uploader }).uploadPrivateFile;
  if (typeof fn !== 'function') throw new Error('La subida de archivos todavía no está disponible.');
  return fn(file);
}

export function recorderSupport(): { ok: true; mimeType: string } | { ok: false; reason: string } {
  if (typeof window === 'undefined' || !window.isSecureContext) return { ok: false, reason: 'Grabar audio requiere una conexión segura (HTTPS).' };
  if (!navigator.mediaDevices?.getUserMedia || typeof MediaRecorder === 'undefined')
    return { ok: false, reason: 'Este navegador no permite grabar audio.' };
  const candidates = ['audio/webm;codecs=opus', 'audio/webm', 'audio/ogg;codecs=opus', 'audio/mp4', 'audio/mp4;codecs=mp4a.40.2'];
  const mimeType = candidates.find(c => MediaRecorder.isTypeSupported?.(c));
  if (!mimeType) return { ok: false, reason: 'Este navegador no admite ningún formato de audio compatible.' };
  return { ok: true, mimeType };
}

export function formatDuration(s: number): string {
  const t = Math.max(0, Math.round(s));
  return `${Math.floor(t / 60)}:${String(t % 60).padStart(2, '0')}`;
}
