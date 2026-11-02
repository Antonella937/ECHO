import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveUniverseBody } from '@workspace/api-zod';
import { createSeedState } from '../src/store/seed';
import { editSocialPost, setPinnedPost, isStoryActive, mentionIds, hashtags, mentionNotifications, groupNotifications, toggleReaction, saveHighlight } from '../src/domain/social-features';
import { selectInbox } from '../src/domain/inbox';
import { applyEvent, makeEvent } from '../src/domain/events';
import { mergeUniverse } from '../src/store/merge';
import { threadIdFor } from '../src/domain/types';
import { universeAccountError } from '../../api-server/src/lib/universeValidation';
import { byteRange, validMediaHeader } from '../../api-server/src/lib/mediaSafety';

test('ubicación, etiquetas, edición y notificaciones de menciones conservan el universo', () => {
  const s = createSeedState(), p = s.posts[0];
  const mar = s.characters.find(c => c.id === 'mar')!;
  const edited = editSocialPost(s, p.id, p.authorId, { caption: `Hola @${mar.handle} #Ensayo`, location: 'Buenos Aires', taggedAccountIds: ['mar'], commentsEnabled: false });
  assert.deepEqual(mentionIds(edited.posts[0].caption, s.characters), ['mar']);
  assert.deepEqual(hashtags('hola #Ensayo #ensayo #Música'), ['ensayo', 'música']);
  assert.equal(edited.posts[0].location, 'Buenos Aires');
  assert.equal(edited.posts[0].commentsEnabled, false);
  const again = mentionNotifications(edited, edited.posts[0].caption, p.authorId, { postId: p.id }, ['mar']);
  assert.equal(again.notifications.length, edited.notifications.length);
  assert.throws(() => editSocialPost(edited, p.id, p.authorId, { caption: 'cambio' }, { caption: p.caption }), /dispositivo/);
  assert.equal(s.posts[0].caption, p.caption);
});

test('máximo tres fijadas por identidad; no permite editar otra identidad', () => {
  let s = createSeedState();
  const template = s.posts[0], actor = template.authorId;
  s.posts = Array.from({ length: 4 }, (_, i) => ({ ...template, id: `pin-${i}` }));
  for (let i = 0; i < 3; i++) s = setPinnedPost(s, `pin-${i}`, actor, true);
  assert.throws(() => setPinnedPost(s, 'pin-3', actor, true), /3/);
  assert.throws(() => editSocialPost(s, 'pin-0', 'not-author', { caption: 'x' }));
  s = setPinnedPost(s, 'pin-0', actor, false);
  assert.doesNotThrow(() => setPinnedPost(s, 'pin-3', actor, true));
});

test('stories vencen exactamente en 24h sin borrarse y siguen en destacadas', () => {
  const s = createSeedState(), story = s.stories[0], now = Date.parse(story.createdAt);
  assert.equal(isStoryActive(story, now + 86400000 - 1), true);
  assert.equal(isStoryActive(story, now + 86400000), false);
  const saved = saveHighlight(s, story.authorId, { id: 'highlight', authorId: story.authorId, title: 'Recuerdo', storyIds: [story.id], createdAt: new Date().toISOString() });
  assert.equal(saved.stories.length, s.stories.length);
  assert.deepEqual(saved.highlights![0].storyIds, [story.id]);
  assert.equal(universeAccountError(SaveUniverseBody.parse({ state: saved, expectedRevision: 1 }).state), null);
});

test('DM multimedia, cita, reacciones, leído y borrar para mí sobreviven al contrato', () => {
  const s = createSeedState(), now = new Date().toISOString();
  s.messages = [{ id: 'media', senderId: 'nela', recipientId: 'mar', threadId: threadIdFor('nela', 'mar'), text: '',
    createdAt: now, readBy: ['nela'], storyId: null, postId: null, origin: 'user',
    attachments: [{ id: 'file', type: 'video', url: '/objects/uploads/video', mimeType: 'video/webm', fileName: 'ensayo.webm' }],
    reactions: toggleReaction([], 'mar', '❤'), hiddenForIds: ['nela'] }];
  s.messages.push({ ...s.messages[0], id: 'reply', text: 'Te respondo', attachments: undefined, quoteMessageId: 'media', hiddenForIds: ['nela'] });
  const parsed = SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state;
  assert.equal(universeAccountError(parsed), null);
  assert.equal(parsed.messages[0].attachments![0].type, 'video');
  assert.equal(selectInbox(s, 'nela').length, 0);
  assert.equal(selectInbox(s, 'mar').length, 1);
  const read = applyEvent(s, makeEvent({ type: 'thread.read', threadId: s.messages[0].threadId, actorId: 'mar' }));
  assert.ok(read.messages[0].readBy.includes('mar'));
  const invalid = structuredClone(parsed); invalid.messages[0].hiddenForIds = ['noah'];
  assert.match(universeAccountError(invalid)!, /participantes/);
  assert.deepEqual(toggleReaction(toggleReaction([], 'mar', '❤'), 'mar', '❤'), []);
});

test('comentarios cerrados no admiten nuevos comentarios; respuestas y likes se conservan', () => {
  const s = createSeedState(), p = s.posts[0];
  const comment = { id: 'root-social', postId: p.id, authorId: 'mar', text: 'Hola', createdAt: new Date().toISOString(), parentId: null, replyToAuthorId: null, likes: [], origin: 'user' as const };
  let next = applyEvent(s, makeEvent({ type: 'comment.created', comment }));
  next = applyEvent(next, makeEvent({ type: 'comment.created', comment: { ...comment, id: 'reply-social', parentId: comment.id } }));
  next = applyEvent(next, makeEvent({ type: 'comment.liked', commentId: comment.id, actorId: 'nela', liked: true }));
  assert.ok(next.comments.find(c => c.id === comment.id)!.likes.includes('nela'));
  next.posts.find(post => post.id === p.id)!.commentsEnabled = false;
  const closed = applyEvent(next, makeEvent({ type: 'comment.created', comment: { ...comment, id: 'blocked' } }));
  assert.equal(closed.comments.some(c => c.id === 'blocked'), false);
  assert.equal(closed.comments.find(c => c.id === 'reply-social')!.parentId, comment.id);
});

test('agrupación mantiene ids y lectura; apariencia y cambios independientes se sincronizan', () => {
  const s = createSeedState(), a = structuredClone(s), b = structuredClone(s);
  a.appearance = { theme: 'system', accent: '#8fb8de' };
  b.posts[0].location = 'Ensayo';
  const merged = mergeUniverse(s, a, b);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(merged.state.appearance, a.appearance);
  assert.equal(merged.state.posts[0].location, 'Ensayo');
  assert.equal(SaveUniverseBody.parse({ state: merged.state, expectedRevision: 1 }).state.appearance!.theme, 'system');
  const n = { id: 'n1', recipientId: 'nela', actorId: 'mar', kind: 'like' as const, postId: 'p', storyId: null, commentId: null, excerpt: '', createdAt: '2026-11-02T12:00:00Z', read: true };
  const groups = groupNotifications([n, { ...n, id: 'n2', actorId: 'noah', read: false }]);
  assert.equal(groups.length, 1); assert.equal(groups[0].count, 2);
  assert.equal(groups[0].read, false); assert.equal(groups[0].ids.length, 2);
});

test('multimedia privada admite rangos y valida firmas; no acepta formatos disfrazados', () => {
  assert.deepEqual(byteRange('bytes=5-9', 20), { start: 5, end: 9 });
  assert.deepEqual(byteRange('bytes=-4', 20), { start: 16, end: 19 });
  assert.equal(byteRange('bytes=21-', 20), 'invalid');
  assert.equal(validMediaHeader(Buffer.from('1a45dfa300000000', 'hex'), 'video/webm'), true);
  assert.equal(validMediaHeader(Buffer.from('OggS000000'), 'audio/ogg'), true);
  assert.equal(validMediaHeader(Buffer.from('not a video'), 'video/mp4'), false);
});
