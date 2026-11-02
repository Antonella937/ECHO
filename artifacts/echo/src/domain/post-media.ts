import type { Post, PostMedia } from './types';

export const MAX_POST_MEDIA = 10;

/** Legacy posts are projected, never rewritten. Order + stable ids address each item. */
export function postMedia(post: Pick<Post, 'id' | 'image' | 'media'>): PostMedia[] {
  return post.media?.length ? post.media : [{ id: `${post.id}:legacy`, type: 'image', url: post.image }];
}

export function validatePostMedia(media: PostMedia[]): void {
  if (!media.length || media.length > MAX_POST_MEDIA) throw new Error('Elegí entre 1 y 10 fotos.');
  const ids = new Set<string>();
  for (const item of media) {
    if (!item.id || item.id.length > 120 || ids.has(item.id)) throw new Error('El carrete contiene identificadores inválidos o repetidos.');
    if (item.type !== 'image') throw new Error('El video todavía no está habilitado. Por ahora podés publicar fotos.');
    if (!item.url?.trim()) throw new Error('Falta una foto del carrete.');
    ids.add(item.id);
  }
}
