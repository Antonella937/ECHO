import test from 'node:test';
import assert from 'node:assert/strict';
import { activateOwnedUniverse, newUniverseInput } from '../src/lib/universe-navigation';

function harness() {
  const calls: string[] = [];
  const input = {
    ownerId: 'owner-a', universeId: 'studio', allowedIds: ['primary', 'studio'],
    isCurrentOwner: () => true,
    flush: async () => { calls.push('flush'); },
    select: (owner: string, universe: string) => { calls.push(`select:${owner}:${universe}`); },
    reload: () => { calls.push('reload'); },
  };
  return { calls, input };
}

test('switch flushes current state before selection and full document reload', async () => {
  const { input, calls } = harness();
  await activateOwnedUniverse(input);
  assert.deepEqual(calls, ['flush', 'select:owner-a:studio', 'reload']);
});

test('foreign or nonexistent universe cannot change selection', async () => {
  const { input, calls } = harness();
  await assert.rejects(activateOwnedUniverse({ ...input, universeId: 'foreign' }), /no está disponible/);
  assert.deepEqual(calls, []);
});

test('missing session blocks switch before writes', async () => {
  const { input, calls } = harness();
  await assert.rejects(activateOwnedUniverse({ ...input, isCurrentOwner: () => false }));
  assert.deepEqual(calls, []);
});

test('failed sync preserves current selection without reload', async () => {
  const { input, calls } = harness();
  await assert.rejects(activateOwnedUniverse({ ...input, flush: async () => { throw Error('conflict'); } }), /conflict/);
  assert.deepEqual(calls, []);
});

test('owner change while saving cannot switch the new session', async () => {
  const { input, calls } = harness();
  let sameOwner = true;
  await assert.rejects(activateOwnedUniverse({
    ...input, isCurrentOwner: () => sameOwner,
    flush: async () => { sameOwner = false; },
  }), /sesión cambió/);
  assert.deepEqual(calls, []);
});

test('repeated switches retain complete owner/universe identity', async () => {
  const { input, calls } = harness();
  for (const universeId of ['studio', 'primary', 'studio']) await activateOwnedUniverse({ ...input, universeId });
  assert.deepEqual(calls.filter(call => call.startsWith('select:')), [
    'select:owner-a:studio', 'select:owner-a:primary', 'select:owner-a:studio',
  ]);
});

const fields = { plan: 'creator' as const, universeName: ' Taller ', displayName: ' Luna ', username: '@Luna.Bajo', bio: '' };

test('creation reuses starter builder with user supplied identity and no demo content', () => {
  const { name, state } = newUniverseInput(fields);
  assert.equal(name, 'Taller');
  assert.equal(state.characters.length, 1);
  assert.equal(state.characters[0].name, 'Luna');
  assert.equal(state.characters[0].handle, 'luna.bajo');
  assert.equal(state.creatorSetup?.plan, 'creator');
  for (const key of ['posts', 'comments', 'stories', 'messages', 'notifications', 'highlights'] as const) assert.deepEqual(state[key], []);
});

test('invalid creation fields are rejected before sending the API request', () => {
  for (const invalid of [
    { universeName: '' }, { universeName: 'x'.repeat(61) },
    { displayName: '' }, { username: 'bad user' }, { username: '' },
  ]) assert.throws(() => newUniverseInput({ ...fields, ...invalid }));
});
