import test from 'node:test';
import assert from 'node:assert/strict';
import { requiresIsolatedKindroidSocial, isolatedKindroidSocialReady, verifiedSocialGroupId } from '../src/ai-engine/social-isolation';

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

test('social group mapping requires explicit memory verification', () => {
  const oldIds = process.env.ECHO_KINDROID_SOCIAL_GROUP_IDS_JSON;
  const oldVerified = process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED;
  try {
    process.env.ECHO_KINDROID_SOCIAL_GROUP_IDS_JSON = JSON.stringify({ mar: 'group12345678' });
    delete process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED;
    assert.equal(verifiedSocialGroupId('mar'), null);
    process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED = 'true';
    assert.equal(verifiedSocialGroupId('mar'), 'group12345678');
    assert.equal(verifiedSocialGroupId('noah'), null);
    process.env.ECHO_KINDROID_SOCIAL_GROUP_IDS_JSON = '{broken';
    assert.equal(verifiedSocialGroupId('mar'), null);
  } finally {
    if (oldIds === undefined) delete process.env.ECHO_KINDROID_SOCIAL_GROUP_IDS_JSON;
    else process.env.ECHO_KINDROID_SOCIAL_GROUP_IDS_JSON = oldIds;
    if (oldVerified === undefined) delete process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED;
    else process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED = oldVerified;
  }
});

test('technical social groups route by actor and universe, not by post author', async () => {
  const { verifiedSocialGroupForActor } = await import('../src/ai-engine/social-isolation');
  const oldMapping = process.env.ECHO_KINDROID_SOCIAL_GROUPS_BY_UNIVERSE_JSON;
  const oldVerified = process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED;
  try {
    process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED = 'true';
    process.env.ECHO_KINDROID_SOCIAL_GROUPS_BY_UNIVERSE_JSON = JSON.stringify({
      primary: { mar: 'group00000001', noah: 'group00000002' },
      blackthorne: { noah: 'group00000003' },
    });
    assert.equal(verifiedSocialGroupForActor('primary', 'noah'), 'group00000002');
    assert.equal(verifiedSocialGroupForActor('primary', 'mar'), 'group00000001');
    assert.equal(verifiedSocialGroupForActor('blackthorne', 'noah'), 'group00000003');
    assert.equal(verifiedSocialGroupForActor('other', 'noah'), null);
    process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED = 'false';
    assert.equal(verifiedSocialGroupForActor('primary', 'noah'), null);
  } finally {
    if (oldMapping === undefined) delete process.env.ECHO_KINDROID_SOCIAL_GROUPS_BY_UNIVERSE_JSON;
    else process.env.ECHO_KINDROID_SOCIAL_GROUPS_BY_UNIVERSE_JSON = oldMapping;
    if (oldVerified === undefined) delete process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED;
    else process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED = oldVerified;
  }
});
