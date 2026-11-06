import assert from 'node:assert/strict';
import test from 'node:test';
import { byteRange, mediaLimits, validMediaHeader } from '../src/lib/mediaSafety';

test('private audio formats have explicit 15 MB limits', () => {
  for (const mime of ['audio/webm', 'audio/ogg', 'audio/mp4', 'audio/mpeg', 'audio/wav']) {
    assert.equal(mediaLimits[mime], 15);
  }
  assert.equal(mediaLimits['audio/aac'], undefined);
  assert.equal(mediaLimits['audio/x-m4a'], undefined);
});

test('reject mismatched audio headers and accept recognized signatures', () => {
  const webm = Buffer.from('1a45dfa3', 'hex');
  const ogg = Buffer.from('OggS' + '00000000');
  const mp4 = Buffer.from('0000ftypisom');
  const wav = Buffer.from('RIFF0000WAVE');
  const mp3 = Buffer.from('ID3');
  assert.equal(validMediaHeader(webm, 'audio/webm'), true);
  assert.equal(validMediaHeader(ogg, 'audio/ogg'), true);
  assert.equal(validMediaHeader(mp4, 'audio/mp4'), true);
  assert.equal(validMediaHeader(wav, 'audio/wav'), true);
  assert.equal(validMediaHeader(mp3, 'audio/mpeg'), true);
  assert.equal(validMediaHeader(ogg, 'audio/webm'), false);
  assert.equal(validMediaHeader(Buffer.from('not audio'), 'audio/mp4'), false);
});

test('private media byte range rejects malformed and out-of-bounds requests', () => {
  assert.deepEqual(byteRange('bytes=0-99', 1000), { start: 0, end: 99 });
  assert.deepEqual(byteRange('bytes=-100', 1000), { start: 900, end: 999 });
  assert.deepEqual(byteRange('bytes=950-', 1000), { start: 950, end: 999 });
  assert.equal(byteRange('bytes=1000-', 1000), 'invalid');
  assert.equal(byteRange('bytes=100-99', 1000), 'invalid');
  assert.equal(byteRange('bytes=garbage', 1000), 'invalid');
  assert.equal(byteRange('bytes=0-1,4-5', 1000), 'invalid');
});
