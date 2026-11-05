import assert from 'node:assert/strict';
import { test } from 'node:test';
import { decodeGeneratedImageDataUrl } from '../src/lib/imageGenerationResponse';

test('decodes a valid PNG data URL without network access', () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0, 0, 0, 0]);
  const result = decodeGeneratedImageDataUrl('data:image/png;base64,' + bytes.toString('base64'));
  assert.equal(result.mimeType, 'image/png');
  assert.deepEqual(result.bytes, bytes);
});

test('rejects remote URLs and malformed content', () => {
  assert.throws(() => decodeGeneratedImageDataUrl('https://example.com/image.png'));
  assert.throws(() => decodeGeneratedImageDataUrl('data:image/png;base64,AAAA'));
  assert.throws(() => decodeGeneratedImageDataUrl(null));
});
