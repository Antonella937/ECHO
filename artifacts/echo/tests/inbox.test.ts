import { test } from 'node:test';
import assert from 'node:assert/strict';
import { selectInbox } from '../src/domain/inbox';
import { threadIdFor, type Message } from '../src/domain/types';
import { applyEvent, makeEvent } from '../src/domain/events';
import { createSeedState } from '../src/store/seed';
import { upgradeAccounts } from '../src/domain/accounts';

const message = (from: string, to: string, extras: Partial<Message> = {}): Message => ({
  id: `${from}-${to}`, senderId: from, recipientId: to, threadId: threadIdFor(from, to),
  text: 'Un mensaje real', createdAt: '2026-01-01T00:00:00Z', readBy: [from],
  storyId: null, postId: null, origin: 'user', ...extras,
});
test('universo nuevo: ninguna conversación ni notificación de mensajes inventada', () => {
  const state = upgradeAccounts(createSeedState());
  assert.equal(state.characters.length, 9); assert.equal(state.messages.length, 0);
  for (const account of state.characters) assert.deepEqual(selectInbox(state, account.id), []);
  assert.equal(state.notifications.some(n => n.kind === 'message' || n.kind === 'story_reply'), false);
  assert.ok(state.posts.length > 0); assert.ok(state.stories.length > 0);
});
test('contactos sin interacción no aparecen; primer mensaje crea una conversación', () => {
  const state = upgradeAccounts(createSeedState());
  const sent = applyEvent(state, makeEvent({ type: 'message.sent', message: message('nela', 'noah') }));
  assert.equal(selectInbox(sent, 'nela').length, 1);
  assert.equal(selectInbox(sent, 'noah')[0].unread, 1);
  assert.deepEqual(selectInbox(sent, 'mar'), []);
});
test('historial persistido, migrado y archivado se conserva sin importar su origen', () => {
  const state = createSeedState();
  state.characters.find(c => c.id === 'mar')!.archived = true;
  state.messages = [message('mar', 'nela', { origin: 'seed' }), message('noah', 'mar', { id: 'other' })];
  const before = structuredClone(state);
  const inbox = selectInbox(state, 'nela');
  assert.equal(inbox.length, 1); assert.equal(inbox[0].other.id, 'mar');
  assert.deepEqual(state, before, 'el selector no modifica ni elimina datos');
});
test('likes, avisos y registros vacíos no crean conversaciones; compartir contenido sí', () => {
  const state = createSeedState();
  state.messages = [message('mar', 'nela', { text: '   ' })];
  assert.deepEqual(selectInbox(state, 'nela'), []);
  state.messages.push(message('noah', 'nela', { text: '', postId: state.posts[0].id }));
  assert.equal(selectInbox(state, 'nela')[0].other.id, 'noah');
});
test('orden por último mensaje y no leídos por identidad, sin duplicar conversaciones', () => {
  const state = createSeedState();
  state.messages = [message('noah', 'nela'), message('mar', 'nela', { createdAt: '2026-02-01T00:00:00Z' }),
    message('nela', 'mar', { id: 'reply', createdAt: '2026-02-02T00:00:00Z' })];
  const inbox = selectInbox(state, 'nela');
  assert.deepEqual(inbox.map(t => t.other.id), ['mar', 'noah']);
  assert.equal(inbox[0].last.id, 'reply'); assert.equal(inbox[0].unread, 1);
});
