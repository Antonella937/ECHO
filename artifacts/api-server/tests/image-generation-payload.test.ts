import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareImageMessage } from '../src/lib/imageGenerationPayload';

test('prepares text without contacting a provider', () => {
  const result = prepareImageMessage('Portrait', 'natural', []);
  assert.equal(result.content.length, 1);
  assert.deepEqual(result.content[0], { type: 'text', text: 'Portrait' });
});

test('encodes reference bytes as data URLs', () => {
  const result = prepareImageMessage('Portrait', 'phone', [{ mimeType: 'image/png', bytes: Buffer.from('hello') }]);
  assert.deepEqual(result.content[1], { type: 'image_url', image_url: { url: 'data:image/png;base64,aGVsbG8=' } });
});

test('rejects more than four references', () => {
  const reference = { mimeType: 'image/png' as const, bytes: Buffer.from('hello') };
  assert.throws(() => prepareImageMessage('Portrait', 'natural', Array(5).fill(reference)));
});
