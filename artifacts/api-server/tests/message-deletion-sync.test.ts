import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../../echo/src/store/seed';
import { mergeUniverse } from '../../echo/src/store/merge';
import type { Message, SocialState } from '../../echo/src/domain/types';

const message = (id: string, text: string): Message => ({
  id, threadId: 'vivienne__ezra', senderId: 'vivienne', recipientId: 'ezra',
  text, createdAt: '2026-11-14T10:00:00.000Z', storyId: null,
  postId: null, readBy: [], origin: 'human',
});

function withMessages(...messages: Message[]): SocialState {
  return { ...createSeedState(), messages };
}

test('unchanged cached message stays deleted when remote intentionally removed it', () => {
  const original = message('deleted-peer-message', 'Old conversation');
  const base = withMessages(original);
  const local = structuredClone(base);
  const remote = withMessages();
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.messages.some(m => m.id === original.id), false);
});

test('edited local DM versus server deletion remains an explicit conflict', () => {
  const original = message('edited-peer-message', 'Original');
  const base = withMessages(original);
  const local = withMessages({ ...original, text: 'New unsynced edit' });
  const remote = withMessages();
  const result = mergeUniverse(base, local, remote);
  assert.ok(result.conflicts.some(c => c.path === 'messages.edited-peer-message'));
  assert.equal(local.messages[0].text, 'New unsynced edit');
});

test('new unsynced DM absent from base is not discarded by server absence', () => {
  const fresh = message('new-peer-message', 'New message');
  const base = withMessages();
  const local = withMessages(fresh);
  const remote = withMessages();
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.ok(result.state.messages.some(m => m.id === fresh.id));
});

test('unrelated existing DM survives another conversation deletion', () => {
  const removed = message('removed', 'Remove');
  const preserved = { ...message('preserved', 'Keep'), threadId: 'nela__vivienne', senderId: 'nela', recipientId: 'vivienne' };
  const base = withMessages(removed, preserved);
  const result = mergeUniverse(base, structuredClone(base), withMessages(preserved));
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.state.messages.map(m => m.id), ['preserved']);
});
