import assert from 'node:assert/strict';
import { test } from 'node:test';
import { canGenerateImages } from '../src/lib/imageGenerationAccess';

test('fails closed when no allowlist or no authenticated user exists', () => {
  assert.equal(canGenerateImages('owner', ''), false);
  assert.equal(canGenerateImages('owner', undefined), false);
  assert.equal(canGenerateImages(undefined, 'owner'), false);
});

test('allows only exact owner identifiers from comma-separated allowlist', () => {
  assert.equal(canGenerateImages('owner', 'someone, owner, other'), true);
  assert.equal(canGenerateImages('own', 'owner'), false);
  assert.equal(canGenerateImages('other', 'someone, owner'), false);
});
