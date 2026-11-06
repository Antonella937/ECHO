import nelaAvatar from '@/assets/media/nela-avatar.jpg';
import nela1 from '@/assets/media/nela-1.jpg';
import nela2 from '@/assets/media/nela-2.jpg';
import nela3 from '@/assets/media/nela-3.jpg';
import nela4 from '@/assets/media/nela-4.jpg';
import marAvatar from '@/assets/media/mar-avatar.jpg';
import mar1 from '@/assets/media/mar-1.jpg';
import mar2 from '@/assets/media/mar-2.jpg';
import mar3 from '@/assets/media/mar-3.jpg';
import mar4 from '@/assets/media/mar-4.jpg';
import noahAvatar from '@/assets/media/noah-avatar.jpg';
import noah1 from '@/assets/media/noah-1.jpg';
import noah2 from '@/assets/media/noah-2.jpg';
import noah3 from '@/assets/media/noah-3.jpg';
import noah4 from '@/assets/media/noah-4.jpg';
import a0 from '@/assets/media/official-pretty-violence.svg';
import a1 from '@/assets/media/official-false-halo.svg';
import a2 from '@/assets/media/official-saint-vulture.svg';
import a3 from '@/assets/media/official-stray-kids.svg';
import a4 from '@/assets/media/official-the-hollow.svg';
import a5 from '@/assets/media/official-dead-static.svg';
import a6 from '@/assets/media/account-default.svg';
import { createContext, useContext, useEffect, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { mediaSourceFor, privateMediaUrl, type MediaHint, type MediaScope, type MediaSource } from './media-source';

const MEDIA: Record<string, string> = {
  'nela-avatar': nelaAvatar,
  'nela-1': nela1,
  'nela-2': nela2,
  'nela-3': nela3,
  'nela-4': nela4,
  'mar-avatar': marAvatar,
  'mar-1': mar1,
  'mar-2': mar2,
  'mar-3': mar3,
  'mar-4': mar4,
  'noah-avatar': noahAvatar,
  'noah-1': noah1,
  'noah-2': noah2,
  'noah-3': noah3,
  'noah-4': noah4,
  'official-pretty-violence': a0,
  'official-false-halo': a1,
  'official-saint-vulture': a2,
  'official-stray-kids': a3,
  'official-the-hollow': a4,
  'official-dead-static': a5,
  'account-default': a6,
};

export function resolveMedia(ref: string, source?: MediaSource): string {
  if (ref.startsWith('asset:')) return MEDIA[ref.slice(6)] ?? '';
  return privateMediaUrl(ref, source);
}

export const MediaScopeContext = createContext<MediaScope | null>(null);

/** Private files require Clerk bearer auth; plain <img src> requests cannot send it.
 * Cache decoded object URLs for the current browser session, never expose signed URLs.
 */
const privateMediaCache = new Map<string, string>();
const privateMediaPending = new Set<string>();
const privateMediaFailures = new Map<string, number>();
const PRIVATE_MEDIA_RETRY_MS = 10_000;
const privateMediaListeners = new Set<() => void>();

/** Explicit retries bypass the cooldown; private URLs and authentication remain unchanged. */
export function retryPrivateMedia(ref: string, source?: MediaSource): void {
  const url = privateMediaUrl(ref, source);
  if (!ref.startsWith('/objects/') && !ref.startsWith('/api/storage/objects/')) return;
  privateMediaFailures.delete(url);
  loadPrivateMedia(url);
}

function loadPrivateMedia(url: string) {
  if (privateMediaCache.has(url) || privateMediaPending.has(url)) return;
  if (Date.now() - (privateMediaFailures.get(url) ?? -Infinity) < PRIVATE_MEDIA_RETRY_MS) return;
  privateMediaPending.add(url);
  void customFetch<Blob>(url, { responseType: 'blob' })
    .then(blob => {
      if (!blob.type.startsWith('image/') && !blob.type.startsWith('video/') && !blob.type.startsWith('audio/')) {
        throw new Error('El servidor devolvió un formato de archivo no compatible.');
      }
      privateMediaFailures.delete(url);
      privateMediaCache.set(url, URL.createObjectURL(blob));
      privateMediaListeners.forEach(notify => notify());
    })
    .catch(error => {
      privateMediaFailures.set(url, Date.now());
      privateMediaListeners.forEach(notify => notify());
      console.warn('No se pudo mostrar un archivo privado de ECHO.', error);
    })
    .finally(() => privateMediaPending.delete(url));
}
export function useMediaResolver() {
  const scope = useContext(MediaScopeContext);
  const [, refresh] = useState(0);
  useEffect(() => {
    const notify = () => refresh(value => value + 1);
    privateMediaListeners.add(notify);
    return () => { privateMediaListeners.delete(notify); };
  }, []);
  return (ref: string, hint?: MediaHint) => {
    const url = resolveMedia(ref, mediaSourceFor(scope, ref, hint));
    if (!ref.startsWith('/objects/') && !ref.startsWith('/api/storage/objects/')) return url;
    if (!privateMediaCache.has(url) && !privateMediaPending.has(url)) {
      queueMicrotask(() => loadPrivateMedia(url));
    }
    return privateMediaCache.get(url) ?? '';
  };
}

/** Downscale and re-encode an image before moving it to private object storage. */
export async function compressImage(file: File, maxEdge = 1440, quality = 0.84): Promise<string> {
  if (!file.type.startsWith('image/')) throw new Error('El archivo no es una imagen.');
  const url = URL.createObjectURL(file);
  try {
    const img = await new Promise<HTMLImageElement>((resolve, reject) => {
      const i = new Image();
      i.onload = () => resolve(i);
      i.onerror = () => reject(new Error('No se pudo leer la imagen.'));
      i.src = url;
    });
    const scale = Math.min(1, maxEdge / Math.max(img.width, img.height));
    const canvas = document.createElement('canvas');
    canvas.width = Math.round(img.width * scale);
    canvas.height = Math.round(img.height * scale);
    const ctx = canvas.getContext('2d');
    if (!ctx) throw new Error('Tu navegador no permite procesar imágenes.');
    ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
    return canvas.toDataURL('image/jpeg', quality);
  } finally {
    URL.revokeObjectURL(url);
  }
}

export async function uploadPrivateImage(dataUrl: string): Promise<string> {
  const image = await fetch(dataUrl).then((response) => response.blob());
  const contentType = image.type || 'image/jpeg';
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(contentType)) {
    throw new Error('El formato de esta imagen no se puede guardar de forma segura.');
  }
  const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
    '/api/storage/uploads/request-url',
    { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'echo-image', size: image.size, contentType }), responseType: 'json' },
  );
  const upload = await fetch(uploadURL, {
    method: 'PUT',
    headers: { 'Content-Type': contentType },
    body: image,
  });
  if (!upload.ok) throw new Error('No se pudo subir la imagen al almacenamiento privado.');

  const claimed = await customFetch<{ objectPath: string }>('/api/storage/uploads/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectPath }), responseType: 'json',
  });
  return claimed.objectPath;
}

/** Private binary attachments. Video/audio bytes are never re-encoded or muted. */
export async function uploadPrivateFile(file: Blob): Promise<import('@/domain/types').MessageAttachment> {
  const mimeType = file.type.split(';')[0].toLowerCase();
  const type = mimeType.startsWith('image/') ? 'image' : mimeType.startsWith('video/') ? 'video' : 'audio';
  const allowed = ['image/jpeg', 'image/png', 'image/webp', 'video/mp4', 'video/webm',
    'audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav'];
  if (!allowed.includes(mimeType)) throw new Error('Formato no compatible. Usá JPG/PNG/WebP, MP4/WebM o audio WebM/Ogg/MP4/MP3/WAV.');
  if (!file.size || file.size > (type === 'video' ? 50 : 15) * 1024 * 1024) throw new Error(`El archivo debe pesar menos de ${type === 'video' ? 50 : 15} MB.`);
  const id = `attachment-${crypto.randomUUID()}`;
  if (type === 'image') {
    const imageFile = file instanceof File ? file : new File([file], 'foto', { type: mimeType });
    return { id, type, url: await uploadPrivateImage(await compressImage(imageFile)), mimeType: 'image/jpeg' };
  }
  const { uploadURL, objectPath } = await customFetch<{ uploadURL: string; objectPath: string }>(
    '/api/storage/uploads/request-url', { method: 'POST', headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ name: 'echo-attachment', size: file.size, contentType: mimeType }), responseType: 'json' },
  );
  let upload: Response;
  try {
    upload = await fetch(uploadURL, { method: 'PUT', headers: { 'Content-Type': mimeType }, body: file });
  } catch {
    throw new Error('No se pudo conectar con Supabase para subir el audio. Comprobá la conexión o las restricciones de Safari.');
  }
  if (!upload.ok) {
    // A 400 from Supabase can mean a disallowed MIME type, an invalid signed URL,
    // or a different storage policy. Don't guess: show the upstream error safely.
    let reason = '';
    try {
      const body = await upload.text();
      const parsed: unknown = JSON.parse(body);
      if (parsed && typeof parsed === 'object') {
        const detail = parsed as Record<string, unknown>;
        const parts = [detail.error, detail.message].filter((value): value is string => typeof value === 'string');
        reason = parts.join(': ').slice(0, 240);
      }
      if (!reason && body) reason = body.replace(/<[^>]*>/g, '').trim().slice(0, 180);
    } catch { /* Some storage failures have no readable response body. */ }
    const suffix = reason ? ` — ${reason}` : '';
    throw new Error(`Supabase rechazó la subida (HTTP ${upload.status})${suffix}`);
  }
  const claimed = await customFetch<{ objectPath: string }>('/api/storage/uploads/claim', {
    method: 'POST', headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ objectPath }), responseType: 'json',
  });
  return { id, type, url: claimed.objectPath, mimeType };
}

export function timeAgo(iso: string): string {
  const diff = Math.max(0, Date.now() - new Date(iso).getTime());
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'ahora';
  if (m < 60) return `${m} min`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h} h`;
  const d = Math.floor(h / 24);
  if (d < 7) return `${d} d`;
  const w = Math.floor(d / 7);
  if (w < 9) return `${w} sem`;
  return new Date(iso).toLocaleDateString('es-ES', { day: 'numeric', month: 'short' });
}

export function postUrl(postId: string): string {
  const base = import.meta.env.BASE_URL.replace(/\/$/, '');
  return `${window.location.origin}${base}/p/${postId}`;
}
