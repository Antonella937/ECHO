import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareImageScene } from '../src/lib/imageScenePreparation';

const path = (n: number) => '/objects/uploads/00000000-0000-0000-0000-' + String(n).padStart(12, '0');
const savedUniverse = {
  currentCharacterId: 'nela',
  characters: [
    { id: 'nela', name: 'Nela', avatar: path(1), identity: { facialDescription: 'NELA_UNIQUE_FRECKLES', referenceImages: [path(2)] } },
    { id: 'mar', name: 'Mar', avatar: path(3), identity: { facialDescription: 'MAR_UNIQUE_SHORT_HAIR', referenceImages: [path(4)] } },
    { id: 'mark', name: 'Mark', avatar: path(5), identity: { facialDescription: 'MARK_NOT_IN_SCENE' } },
  ],
};

test('persisted-universe-shaped fixture resolves distinct characters and private references without provider calls', () => {
  const active = savedUniverse.characters.find(c => c.id === savedUniverse.currentCharacterId)!;
  const result = prepareImageScene('Selfie de Nela con Mar en el estudio', active, savedUniverse.characters, 'phone');
  assert.deepEqual(result.people.map(p => p.name), ['Nela', 'Mar']);
  assert.deepEqual(result.referencePaths, [path(1), path(3), path(2), path(4)]);
  assert.deepEqual(result.referenceAssignments, ['Nela', 'Mar', 'Nela', 'Mar']);
  assert.match(result.preparedPrompt, /NELA_UNIQUE_FRECKLES/);
  assert.match(result.preparedPrompt, /MAR_UNIQUE_SHORT_HAIR/);
  assert.doesNotMatch(result.preparedPrompt, /MARK_NOT_IN_SCENE/);
  assert.match(result.preparedPrompt, /image 1 = Nela; image 2 = Mar/);
});

test('rejects foreign-looking paths and uses one character if no other name is mentioned', () => {
  const active = savedUniverse.characters[0];
  const result = prepareImageScene('Nela sola en el estudio', active, savedUniverse.characters, 'natural');
  assert.deepEqual(result.people.map(p => p.id), ['nela']);
  assert.deepEqual(result.referencePaths, [path(1), path(2)]);
});
