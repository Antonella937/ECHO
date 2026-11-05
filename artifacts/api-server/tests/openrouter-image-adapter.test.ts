import assert from 'node:assert/strict';
import { test } from 'node:test';
import { buildOpenRouterImageRequest, parseOpenRouterImageResponse } from '../src/lib/openRouterImageAdapter';

test('builds the documented Images API payload for four private image references', () => {
  const ref = { mimeType: 'image/png' as const, bytes: Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]) };
  const body = buildOpenRouterImageRequest('Photographic portrait', [ref, ref, ref, ref]);
  assert.equal(body.n, 1);
  assert.equal(body.resolution, '1K');
  assert.equal(body.input_references?.length, 4);
  assert.equal(body.input_references?.[0].image_url.url.startsWith('data:image/png;base64,'), true);
});

test('parses the documented buffered response shape and cost', () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const output = parseOpenRouterImageResponse({
    data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }],
    usage: { cost: 0.02 },
  });
  assert.equal(output.provider, 'openrouter');
  assert.equal(output.billedUsd, 0.02);
  assert.deepEqual(output.bytes, bytes);
});

test('fails closed on absent usage cost', () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  assert.throws(() => parseOpenRouterImageResponse({ data: [{ b64_json: bytes.toString('base64'), media_type: 'image/png' }] }), /COST_UNKNOWN/);
});
