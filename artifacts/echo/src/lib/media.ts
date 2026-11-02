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
};

export function resolveMedia(ref: string): string {
  if (ref.startsWith('asset:')) return MEDIA[ref.slice(6)] ?? '';
  return ref;
}

/** Downscale and re-encode an uploaded image so it fits comfortably in local storage. */
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
