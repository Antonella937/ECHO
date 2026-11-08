import test from 'node:test';
import assert from 'node:assert/strict';
import { resolveFalImagePayload } from '../src/lib/falImageTransport';
import { validateGeneratedImage } from '../src/lib/generatedImageStorage';

const jpeg = Buffer.from([0xff,0xd8,0xff,0xe0,0,2,0xff,0xd9]);
test('accepts an offline JPEG before private storage', () => {
  assert.doesNotThrow(() => validateGeneratedImage(jpeg, 'image/jpeg'));
  assert.throws(() => validateGeneratedImage(Buffer.from('not an image'), 'image/jpeg'), /INVALID_GENERATED_IMAGE/);
});
test('converts a fal data URI into JPEG bytes without network access', async () => {
  const image = await resolveFalImagePayload({ images: [{ url: 'data:image/jpeg;base64,' + jpeg.toString('base64') }] },
    (async () => { throw Error('NETWORK_NOT_EXPECTED'); }) as typeof fetch);
  assert.deepEqual(image.bytes, jpeg);
});
test('downloads an allowlisted fal image as bytes, not a URL', async () => {
  let requests = 0;
  const fetchImpl = (async (url: string | URL | Request, init?: RequestInit) => {
    requests++;
    assert.equal(String(url), 'https://fal.media/files/example.jpg');
    assert.equal(init?.redirect, 'error');
    return new Response(new Uint8Array(jpeg), { status: 200, headers: { 'content-type': 'image/jpeg' } });
  }) as typeof fetch;
  const result = await resolveFalImagePayload({ images: [{ url: 'https://fal.media/files/example.jpg' }] }, fetchImpl);
  assert.deepEqual(result.bytes, jpeg);
  assert.equal(requests, 1);
});
test('rejects untrusted external URLs without making a request', async () => {
  let requests = 0;
  const fetchImpl = (async () => { requests++; throw Error('NETWORK_NOT_EXPECTED'); }) as typeof fetch;
  for (const url of ['http://fal.media/a.jpg','https://example.com/a.jpg','https://fal.media.evil.com/a.jpg','https://127.0.0.1/a.jpg']) {
    await assert.rejects(resolveFalImagePayload({ images: [{ url }] }, fetchImpl), /FAL_IMAGE_URL_NOT_ALLOWED/);
  }
  assert.equal(requests, 0);
});
