import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCharacterImagePrompt, buildMultiCharacterImagePrompt, resolveSceneCharacters, imageStyleInstructions } from '../src/lib/imagePromptBuilder';

test('builds realistic prompt with character appearance and user scene', () => {
  const prompt = buildCharacterImagePrompt({
    name: 'Nela', scene: 'Selfie in a cafe', style: 'phone',
    identity: { facialDescription: 'Freckles and dark straight hair', bodyDescription: 'Natural proportions' },
  });
  assert.match(prompt, /Freckles and dark straight hair/);
  assert.match(prompt, /Selfie in a cafe/);
  assert.match(prompt, /smartphone snapshot/);
  assert.match(prompt, /Avoid waxy\/plastic skin/);
});

test('supports every available photographic style', () => {
  for (const style of Object.keys(imageStyleInstructions) as Array<keyof typeof imageStyleInstructions>) {
    assert.ok(buildCharacterImagePrompt({ name: 'Character', scene: 'At home', style, identity: {} }).includes(imageStyleInstructions[style]));
  }
});

test('rejects empty scenes', () => {
  assert.throws(() => buildCharacterImagePrompt({ name: 'Nela', scene: ' ', style: 'natural', identity: {} }), /INVALID_IMAGE_SCENE/);
});

test('recognizes multiple people by whole name without blending their identities', () => {
  const nela = { id: 'n', name: 'Nela', identity: { facialDescription: 'freckles' } };
  const mar = { id: 'm', name: 'Mar', identity: { facialDescription: 'short dark hair' } };
  const mark = { id: 'x', name: 'Mark', identity: {} };
  const people = resolveSceneCharacters('Una selfie de Nela con Mar en el estudio', nela, [nela, mar, mark]);
  assert.deepEqual(people.map(person => person.name), ['Nela', 'Mar']);
  const prompt = buildMultiCharacterImagePrompt({ characters: people, scene: 'Nela con Mar en el estudio', style: 'phone' });
  assert.match(prompt, /Person 1: Nela/);
  assert.match(prompt, /Person 2: Mar/);
  assert.match(prompt, /freckles/);
  assert.match(prompt, /short dark hair/);
  assert.match(prompt, /Do not merge, swap/);
});

test('does not select archived characters or match names inside longer words', () => {
  const active = { id: 'a', name: 'Nela' };
  const mar = { id: 'b', name: 'Mar', archived: true };
  assert.deepEqual(resolveSceneCharacters('Nela en el mar', active, [active, mar]).map(p => p.id), ['a']);
});
