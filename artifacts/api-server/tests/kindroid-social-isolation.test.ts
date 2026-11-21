import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresIsolatedKindroidSocial, isolatedKindroidSocialReady } from '../src/ai-engine/social-isolation';

const ownerId = 'user_3LeoBfUicTthDVixNbkPlqXFkdZ';

test('all founder social situations require an isolated Kindroid route', () => {
  for (const situation of ['post', 'comment', 'story_reaction', 'like_post', 'like_comment']) {
    assert.equal(requiresIsolatedKindroidSocial({ live: true, ownerId, situation }), true, situation);
  }
});
test('private DMs and non-founder universes are not blocked by the social boundary', () => {
  assert.equal(requiresIsolatedKindroidSocial({ live: true, ownerId, situation: 'dm' }), false);
  assert.equal(requiresIsolatedKindroidSocial({ live: true, ownerId: 'another-owner', situation: 'comment' }), false);
  assert.equal(requiresIsolatedKindroidSocial({ live: false, ownerId, situation: 'post' }), false);
});
test('unverified isolated social endpoint must remain disabled', () => {
  assert.equal(isolatedKindroidSocialReady(), false);
});
