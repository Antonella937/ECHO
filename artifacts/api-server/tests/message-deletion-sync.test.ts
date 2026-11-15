import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../../echo/src/store/seed';
import { mergeUniverse } from '../../echo/src/store/merge';
import type { Message, SocialState } from '../../echo/src/domain/types';

const message = (id: string, text: string): Message => ({
  id, threadId: 'vivienne__ezra', senderId: 'vivienne', recipientId: 'ezra',
  text, createdAt: '2026-11-14T10:00:00.000Z', storyId: null,
  postId: null, readBy: [], origin: 'user',
});

function withMessages(...messages: Message[]): SocialState {
  return { ...createSeedState(), messages };
}

test('unchanged cached message stays deleted when remote intentionally removed it', () => {
  const original = message('deleted-peer-message', 'Old conversation');
  const base = withMessages(original);
  const local = structuredClone(base);
  const remote = structuredClone(base);
  remote.messages = [];
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.messages.some(m => m.id === original.id), false);
});

test('edited local DM versus server deletion remains an explicit conflict', () => {
  const original = message('edited-peer-message', 'Original');
  const base = withMessages(original);
  const local = structuredClone(base);
  local.messages = [{ ...original, text: 'New unsynced edit' }];
  const remote = structuredClone(base);
  remote.messages = [];
  const result = mergeUniverse(base, local, remote);
  assert.ok(result.conflicts.some(c => c.path === 'messages.edited-peer-message'));
  assert.equal(local.messages[0].text, 'New unsynced edit');
});

test('new unsynced DM absent from base is not discarded by server absence', () => {
  const fresh = message('new-peer-message', 'New message');
  const base = withMessages();
  const local = structuredClone(base);
  local.messages = [fresh];
  const remote = structuredClone(base);
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.ok(result.state.messages.some(m => m.id === fresh.id));
});

test('unrelated existing DM survives another conversation deletion', () => {
  const removed = message('removed', 'Remove');
  const preserved = { ...message('preserved', 'Keep'), threadId: 'nela__vivienne', senderId: 'nela', recipientId: 'vivienne' };
  const base = withMessages(removed, preserved);
  const remote = structuredClone(base);
  remote.messages = [preserved];
  const result = mergeUniverse(base, structuredClone(base), remote);
  assert.equal(result.conflicts.length, 0);
  assert.deepEqual(result.state.messages.map(m => m.id), ['preserved']);
});

test('explicit server choice removes a locally edited deleted message', () => {
  const original = message('resolved-server', 'Before');
  const base = withMessages(original);
  const local = structuredClone(base);
  local.messages = [{ ...original, text: 'Unsent edit' }];
  const remote = structuredClone(base);
  remote.messages = [];
  const result = mergeUniverse(base, local, remote, { 'messages.resolved-server': 'remote' });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.messages.some(m => m.id === original.id), false);
});

test('explicit device choice preserves a locally edited deleted message', () => {
  const original = message('resolved-local', 'Before');
  const base = withMessages(original);
  const local = structuredClone(base);
  local.messages = [{ ...original, text: 'Unsent edit' }];
  const remote = structuredClone(base);
  remote.messages = [];
  const result = mergeUniverse(base, local, remote, { 'messages.resolved-local': 'local' });
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.messages.find(m => m.id === original.id)?.text, 'Unsent edit');
});

test('independent universe merges do not alter messages from another world', () => {
  const blackthorneMessage = message('blackthorne-only', 'Academy message');
  const musicMessage = { ...message('music-only', 'Band message'),
    threadId: 'nela__mar', senderId: 'nela', recipientId: 'mar' };
  const academyBase = withMessages(blackthorneMessage);
  const academyRemote = structuredClone(academyBase);
  academyRemote.messages = [];
  const musicBase = withMessages(musicMessage);
  const musicLocal = structuredClone(musicBase);
  const musicRemote = structuredClone(musicBase);
  const academyResult = mergeUniverse(academyBase, structuredClone(academyBase), academyRemote);
  const musicResult = mergeUniverse(musicBase, musicLocal, musicRemote);
  assert.deepEqual(academyResult.state.messages.map(m => m.id), []);
  assert.deepEqual(musicResult.state.messages.map(m => m.id), ['music-only']);
  assert.equal(musicResult.conflicts.length, 0);
});

test('a missing recovery base does not silently discard a locally present DM', () => {
  const local = withMessages(message('legacy-local', 'Preserve imported message'));
  const remote = structuredClone(local);
  remote.messages = [];
  const result = mergeUniverse(null, local, remote);
  assert.ok(result.state.messages.some(m => m.id === 'legacy-local'));
});
