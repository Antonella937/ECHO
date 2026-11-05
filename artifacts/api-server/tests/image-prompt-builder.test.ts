import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildCharacterImagePrompt, imageStyleInstructions } from '../src/lib/imagePromptBuilder';

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
