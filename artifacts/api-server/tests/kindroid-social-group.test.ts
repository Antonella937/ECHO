import test from 'node:test';
import assert from 'node:assert/strict';
import { sendKindroidSocialGroupContext, kindroidSocialGroupProvider } from '../src/ai-engine/kindroid-social-group';

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

test('social group converts the selected Kin response to an ECHO like without private DM calls', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    return new Response(path.endsWith('get-turn') ? 'kin123456789' : path.endsWith('ai-response') ? 'LIKE' : '', { status: 200 });
  }) as typeof fetch;
  try {
    const result = await kindroidSocialGroupProvider('group12345678', 'kin123456789', 'like_post', 'Noah posted a guitar photo', undefined, request).complete({
      system: '', context: '', outputSchema: {},
    });
    assert.deepEqual(calls, ['/v1/groupchats-user-message', '/v1/groupchats-get-turn', '/v1/groupchats-ai-response']);
    assert.equal(JSON.parse(result.text).action, 'like');
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test('a different Kin cannot impersonate the intended character', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    return new Response(path.endsWith('get-turn') ? 'otherKin1234' : '', { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      kindroidSocialGroupProvider('group12345678', 'kin123456789', 'comment',
        'Mar commented on Noah post', undefined, request).complete({
          system: '', context: '', outputSchema: {},
        }),
      /KINDROID_GROUP_SPEAKER_MISMATCH/,
    );
    assert.deepEqual(calls, ['/v1/groupchats-user-message', '/v1/groupchats-get-turn']);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test('two requests to the same social group never interleave context and responses', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    await Promise.resolve();
    return new Response(path.endsWith('get-turn') ? 'kin123456789'
      : path.endsWith('ai-response') ? 'LIKE' : '', { status: 200 });
  }) as typeof fetch;
  try {
    const first = kindroidSocialGroupProvider('group12345678', 'kin123456789', 'like_post', 'Mar post A', undefined, request);
    const second = kindroidSocialGroupProvider('group12345678', 'kin123456789', 'like_post', 'Mar post B', undefined, request);
    await Promise.all([
      first.complete({ system: '', context: '', outputSchema: {} }),
      second.complete({ system: '', context: '', outputSchema: {} }),
    ]);
    const one = ['/v1/groupchats-user-message', '/v1/groupchats-get-turn', '/v1/groupchats-ai-response'];
    assert.deepEqual(calls, [...one, ...one]);
    assert.equal(calls.filter(path => path === '/v1/send-message').length, 0);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test('invalid Kindroid social choice fails closed without a private fallback', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    return new Response(path.endsWith('get-turn') ? 'kin123456789'
      : path.endsWith('ai-response') ? 'NOT_A_VALID_SOCIAL_CHOICE' : '', { status: 200 });
  }) as typeof fetch;
  try {
    await assert.rejects(
      kindroidSocialGroupProvider('group12345678', 'kin123456789', 'like_post',
        'Visible post', undefined, request).complete({
          system: '', context: '', outputSchema: {},
        }),
      /KINDROID_SOCIAL_DECISION_INVALID/,
    );
    assert.deepEqual(calls, [
      '/v1/groupchats-user-message',
      '/v1/groupchats-get-turn',
      '/v1/groupchats-ai-response',
    ]);
    assert.equal(calls.some(path => path === '/v1/send-message'), false);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test('a VIEW story choice creates no reaction and never touches private history', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    return new Response(path.endsWith('get-turn') ? 'kin123456789'
      : path.endsWith('ai-response') ? 'VIEW' : '', { status: 200 });
  }) as typeof fetch;
  try {
    const result = await kindroidSocialGroupProvider('group12345678', 'kin123456789',
      'story_reaction', 'Visible story', undefined, request).complete({
        system: '', context: '', outputSchema: {},
      });
    const decision = JSON.parse(result.text);
    assert.equal(decision.action, 'none');
    assert.equal(decision.reaction, null);
    assert.equal(calls.includes('/v1/send-message'), false);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test('SKIP suppresses a public comment without posting or using private history', async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = 'test-key';
  const calls: string[] = [];
  const request = (async (url: string | URL | Request) => {
    const path = new URL(String(url)).pathname;
    calls.push(path);
    return new Response(path.endsWith('get-turn') ? 'kin123456789'
      : path.endsWith('ai-response') ? 'SKIP' : '', { status: 200 });
  }) as typeof fetch;
  try {
    const result = await kindroidSocialGroupProvider('group12345678', 'kin123456789',
      'comment', 'Visible post', undefined, request).complete({
        system: '', context: '', outputSchema: {},
      });
    const decision = JSON.parse(result.text);
    assert.equal(decision.action, 'none');
    assert.equal(decision.text, null);
    assert.equal(calls.includes('/v1/send-message'), false);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});
