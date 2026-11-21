import test from 'node:test';
import assert from 'node:assert/strict';
import { socialActionIdempotencyKey } from '../src/ai-engine/social-action-idempotency';

const base = {
  ownerId: 'owner', universeId: 'primary', actorId: 'noah',
  situation: 'comment' as const, eventId: 'post-event-42', targetId: 'mar-post',
};

test('retries of the same social opportunity produce one stable key', () => {
  const first = socialActionIdempotencyKey(base);
  assert.match(first, /^[a-f0-9]{64}$/);
  assert.equal(first, socialActionIdempotencyKey({ ...base }));
});

test('different actors, universes, targets and events never share a key', () => {
  const keys = [
    base,
    { ...base, actorId: 'mar' },
    { ...base, universeId: 'blackthorne' },
    { ...base, targetId: 'other-post' },
    { ...base, eventId: 'post-event-43' },
    { ...base, situation: 'like_post' as const },
  ].map(socialActionIdempotencyKey);
  assert.equal(new Set(keys).size, keys.length);
});

test('missing identity is rejected', () => {
  assert.throws(() => socialActionIdempotencyKey({ ...base, eventId: '' }), /SOCIAL_ACTION_IDENTITY_INVALID/);
});
