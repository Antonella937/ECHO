import type { Post, PostMedia } from './types';

export const MAX_POST_MEDIA = 10;

/** Legacy posts are projected, never rewritten. Empty image means a text-only post. */
export function postMedia(post: Pick<Post, 'id' | 'image' | 'media'>): PostMedia[] {
  if (post.media?.length) return post.media;
  return typeof post.image === 'string' && post.image.trim()
    ? [{ id: `${post.id}:legacy`, type: 'image', url: post.image }]
    : [];
}

export function validatePostMedia(media: PostMedia[]): void {
  if (!media.length || media.length > MAX_POST_MEDIA) throw new Error('Elegí entre 1 y 10 fotos o videos.');
  const ids = new Set<string>();
  for (const item of media) {
    if (!item.id || item.id.length > 120 || ids.has(item.id)) throw new Error('El carrete contiene identificadores inválidos o repetidos.');
    if (!['image', 'video'].includes(item.type)) throw new Error('Formato de publicación no válido.');
    if (!item.url?.trim()) throw new Error('Falta una foto del carrete.');
    ids.add(item.id);
  }
}
