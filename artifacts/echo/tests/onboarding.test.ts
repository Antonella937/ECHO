import test from 'node:test';
import assert from 'node:assert/strict';
import { archiveAccount, upgradeAccounts } from '../src/domain/accounts';
import { deletionBlockReason } from '../src/domain/character-core';
import { createStarterUniverse } from '../src/store/create-starter-universe';
import { shouldShowCreatorOnboarding } from '../src/store/onboarding-routing';

const input = {
  plan: 'free' as const,
  universeName: 'Mi espacio',
  displayName: 'Luz',
  username: '@Luz.Fotos',
  bio: 'Un mundo en construcción.',
};

test('el universo inicial guarda selección y primer perfil sin datos sociales de demo', () => {
  const state = createStarterUniverse(input, '2026-11-03T12:00:00.000Z');
  assert.equal(state.creatorSetup?.plan, 'free');
  assert.equal(state.creatorSetup?.universeName, 'Mi espacio');
  assert.equal(state.creatorSetup?.completedAt, '2026-11-03T12:00:00.000Z');
  assert.equal(state.currentCharacterId, 'nela');
  assert.equal(state.characters.length, 1);
  assert.equal(state.characters[0].name, 'Luz');
  assert.equal(state.characters[0].handle, 'luz.fotos');
  assert.equal(state.characters[0].bio, 'Un mundo en construcción.');
  assert.equal(state.characters[0].avatar, 'asset:account-default');
  assert.deepEqual(state.characters[0].identity.referenceImages, []);
  assert.equal(state.characters[0].identity.appearance, '');
  assert.equal(state.characters[0].identity.seed, 0);
  assert.equal(upgradeAccounts(state).characters.length, 1);
  assert.match(deletionBlockReason(state, 'nela') ?? '', /^Luz es la identidad principal/);
  assert.throws(() => archiveAccount(state, 'nela', true), /Luz es la identidad principal/);
  assert.deepEqual(state.follows, { nela: [] });
  for (const key of ['posts', 'comments', 'stories', 'messages', 'notifications', 'highlights'] as const) {
    assert.deepEqual(state[key], []);
  }
});

test('el onboarding no se muestra si ya existe universo remoto', () => {
  assert.equal(shouldShowCreatorOnboarding(true, false), false);
});

test('el onboarding preserva datos heredados/recuperables y solo aparece para un owner vacío', () => {
  assert.equal(shouldShowCreatorOnboarding(false, true), false);
  assert.equal(shouldShowCreatorOnboarding(false, false), true);
});

test('la selección Creator también se persiste sin activar pagos', () => {
  const state = createStarterUniverse({ ...input, plan: 'creator' }, '2026-11-03T12:00:00.000Z');
  assert.equal(state.creatorSetup?.plan, 'creator');
  assert.equal(state.posts.length, 0);
});
