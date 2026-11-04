import assert from 'node:assert/strict';
import test from 'node:test';
import { createStarterUniverse } from '../src/store/create-starter-universe';

test('a new beta participant gets a blank universe with their own visible identity', () => {
  const state = createStarterUniverse({
    plan: 'free',
    universeName: 'El universo de Ala',
    displayName: 'Ala',
    username: 'ala_beta',
    bio: 'Probando ECHO',
  }, '2026-11-04T00:00:00.000Z');
  assert.equal(state.characters.length, 1);
  assert.equal(state.characters[0].name, 'Ala');
  assert.equal(state.characters[0].handle, 'ala_beta');
  assert.equal(state.characters[0].avatar, 'asset:account-default');
  assert.deepEqual(state.characters[0].identity.referenceImages, []);
  for (const key of ['posts', 'comments', 'stories', 'messages', 'notifications', 'highlights'] as const) {
    assert.deepEqual(state[key], [], key + ' must start empty');
  }
  assert.deepEqual(state.follows[state.currentCharacterId], []);
  assert.equal(state.creatorSetup?.universeName, 'El universo de Ala');
});
