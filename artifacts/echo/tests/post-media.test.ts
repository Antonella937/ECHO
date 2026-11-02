import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveUniverseBody } from '@workspace/api-zod';
import { createSeedState } from '../src/store/seed';
import { postMedia, validatePostMedia } from '../src/domain/post-media';
import { mergeUniverse } from '../src/store/merge';
import { applyEvent, makeEvent } from '../src/domain/events';
import { universeAccountError } from '../../api-server/src/lib/universeValidation';
import type { PostMedia } from '../src/domain/types';

const photos: PostMedia[] = [
  { id: 'photo-a', type: 'image', url: 'asset:nela-1', mimeType: 'image/jpeg' },
  { id: 'photo-b', type: 'image', url: 'asset:nela-2', mimeType: 'image/jpeg', width: 100, height: 200 },
  { id: 'photo-c', type: 'image', url: 'asset:nela-3' },
];
function fixture() {
  const s = createSeedState();
  s.posts[0] = { ...s.posts[0], media: structuredClone(photos), image: photos[0].url };
  return s;
}

test('foto antigua se proyecta sin migración ni reescritura de la publicación', () => {
  const s = createSeedState(), original = structuredClone(s);
  const items = postMedia(s.posts[0]);
  assert.equal(items.length, 1); assert.equal(items[0].url, s.posts[0].image);
  assert.equal(items[0].id, postMedia(s.posts[0])[0].id);
  assert.deepEqual(s, original);
});

test('contrato conserva orden, ids y metadatos individuales sin inventar análisis', () => {
  const s = fixture(), body = SaveUniverseBody.parse({ state: s, expectedRevision: 2 });
  assert.deepEqual(body.state.posts[0].media, photos);
  assert.equal(universeAccountError(body.state), null);
  assert.deepEqual(postMedia(s.posts[0]), photos);
  assert.equal(body.state.posts[0].caption, s.posts[0].caption);
});

test('validación rechaza vacío, exceso, ids repetidos, portada desalineada y video no habilitado', () => {
  assert.throws(() => validatePostMedia([]));
  assert.throws(() => validatePostMedia(Array.from({ length: 11 }, (_, i) => ({ ...photos[0], id: String(i) }))));
  assert.throws(() => validatePostMedia([photos[0], photos[0]]));
  const s = fixture(); s.posts[0].image = photos[1].url;
  assert.match(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state)!, /portada/);
  s.posts[0].image = photos[0].url; s.posts[0].media![1].type = 'video';
  assert.throws(() => validatePostMedia(s.posts[0].media!), /video/);
  // The schema prepares video metadata, but the current server explicitly refuses it.
  assert.match(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state)!, /video/);
  s.posts[0].media = [];
  assert.equal(SaveUniverseBody.safeParse({ state: s, expectedRevision: 1 }).success, false);
});

test('likes y guardados de distintos dispositivos preservan el carrete y aplican al post entero', () => {
  const base = fixture(), a = structuredClone(base), b = structuredClone(base);
  const id = base.posts[0].id;
  a.posts[0].likes = ['nela']; b.posts[0].savedBy = ['mar'];
  const merged = mergeUniverse(base, a, b);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(merged.state.posts[0].media, photos);
  assert.deepEqual(merged.state.posts[0].likes, ['nela']);
  assert.deepEqual(merged.state.posts[0].savedBy, ['mar']);
  assert.equal(merged.state.posts[0].id, id);
});

test('conflicto de orden de un mismo carrete exige decisión sin mezclar las versiones', () => {
  const base = fixture(), a = structuredClone(base), b = structuredClone(base);
  a.posts[0].media = [photos[1], photos[0], photos[2]]; a.posts[0].image = photos[1].url;
  b.posts[0].media = [photos[2], photos[1], photos[0]]; b.posts[0].image = photos[2].url;
  const merged = mergeUniverse(base, a, b);
  assert.ok(merged.conflicts.some(c => c.path.endsWith('.media')));
  const path = `posts.${base.posts[0].id}`;
  const resolved = mergeUniverse(base, a, b, { [`${path}.media`]: 'local', [`${path}.image`]: 'local' });
  assert.equal(resolved.conflicts.length, 0);
  assert.deepEqual(resolved.state.posts[0].media, a.posts[0].media);
});

test('crear carrete es un único post, su comentario referencia el post y el borrado no deja comentarios', () => {
  const base = createSeedState();
  const post = { ...base.posts[0], id: 'new-carousel', image: photos[0].url, media: structuredClone(photos), likes: [], savedBy: [] };
  let state = applyEvent(base, makeEvent({ type: 'post.created', post }));
  assert.equal(state.posts.length, base.posts.length + 1);
  state = applyEvent(state, makeEvent({ type: 'comment.created', comment: {
    id: 'carousel-comment', postId: post.id, authorId: 'mar', text: 'La segunda foto',
    createdAt: new Date().toISOString(), parentId: null, replyToAuthorId: null, likes: [], origin: 'user',
  } }));
  assert.equal(state.comments.find(c => c.id === 'carousel-comment')?.postId, post.id);
  state = applyEvent(state, makeEvent({ type: 'post.deleted', postId: post.id, actorId: post.authorId }));
  assert.equal(state.posts.some(p => p.id === post.id), false);
  assert.equal(state.comments.some(c => c.postId === post.id), false);
});
