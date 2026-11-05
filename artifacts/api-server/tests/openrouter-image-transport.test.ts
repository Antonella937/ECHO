import assert from 'node:assert/strict';
import { test } from 'node:test';
import { requestOpenRouterImage } from '../src/lib/openRouterImageTransport';

const png = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
test('makes exactly one request to provider with secret in header and parses result', async () => {
  let calls = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), 'https://openrouter.ai/api/v1/images');
    assert.equal(init?.method, 'POST');
    assert.equal((init?.headers as Record<string, string>).Authorization, 'Bearer private-test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.n, 1);
    assert.equal(body.prompt, 'Realistic portrait');
    return new Response(JSON.stringify({ data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }], usage: { cost: 0.02 } }), { status: 200 });
  }) as typeof fetch;
  const result = await requestOpenRouterImage({ apiKey: 'private-test-key', prompt: 'Realistic portrait', references: [], fetchImpl });
  assert.equal(calls, 1);
  assert.equal(result.billedUsd, 0.02);
  assert.deepEqual(result.bytes, png);
});

test('never retries failed provider responses', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; return new Response('no', { status: 429 }); }) as typeof fetch;
  await assert.rejects(requestOpenRouterImage({ apiKey: 'test', prompt: 'Portrait', references: [], fetchImpl }), /HTTP_429/);
  assert.equal(calls, 1);
});

test('does not contact provider without a key or with invalid references', async () => {
  let calls = 0;
  const fetchImpl = (async () => { calls++; throw Error('should not run'); }) as typeof fetch;
  await assert.rejects(requestOpenRouterImage({ apiKey: '', prompt: 'Portrait', references: [], fetchImpl }), /KEY_MISSING/);
  await assert.rejects(requestOpenRouterImage({ apiKey: 'test', prompt: 'Portrait', references: [{ mimeType: 'image/png', bytes: Buffer.alloc(15_000_001) }], fetchImpl }), /REFERENCE_SIZE/);
  assert.equal(calls, 0);
});
