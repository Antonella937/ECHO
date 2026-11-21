import test from 'node:test';
import assert from 'node:assert/strict';
import { sendKindroidSocialGroupContext } from '../src/ai-engine/kindroid-social-group';

test('social context is posted only to the group endpoint', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const calls: Array<{ url: string; body: Record<string, unknown> }> = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    calls.push({ url: String(url), body: JSON.parse(String(init?.body)) });
    return new Response('', { status: 200 });
  }) as typeof fetch;
  try {
    await sendKindroidSocialGroupContext('group12345678', 'Post by Nela: studio selfie', request);
    assert.equal(calls.length, 1);
    assert.equal(new URL(calls[0].url).pathname, '/v1/groupchats-user-message');
    assert.deepEqual(calls[0].body, { group_id: 'group12345678', message: 'Post by Nela: studio selfie' });
    assert.equal('ai_id' in calls[0].body, false);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test('invalid group and empty context are rejected before network use', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const request = (async () => { throw new Error('network should not be used'); }) as typeof fetch;
  try {
    await assert.rejects(sendKindroidSocialGroupContext('invalid!', 'context', request));
    await assert.rejects(sendKindroidSocialGroupContext('group12345678', '  ', request));
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});
