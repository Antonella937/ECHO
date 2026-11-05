import assert from 'node:assert/strict';
import { test } from 'node:test';
import { prepareImagePipeline, parseImagePipelineResult } from '../src/lib/imageGenerationPipeline';

test('prepares a zero-cost pipeline message with no provider call', () => {
  const message = prepareImagePipeline({ prompt: 'A candid photograph', style: 'natural', references: [] });
  assert.deepEqual(message.content, [{ type: 'text', text: 'A candid photograph' }]);
});

test('accepts a mocked image result with an explicit cost', () => {
  const bytes = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10, 0]);
  const dataUrl = 'data:image/png;base64,' + bytes.toString('base64');
  const result = parseImagePipelineResult({ images: [{ image_url: { url: dataUrl } }], usage: { cost: 0.02 } }, 'mock', 'mock-image');
  assert.equal(result.mimeType, 'image/png');
  assert.equal(result.billedUsd, 0.02);
  assert.deepEqual(result.bytes, bytes);
});

test('rejects missing cost reports and remote image URLs', () => {
  const image = { image_url: { url: 'https://example.com/picture.png' } };
  assert.throws(() => parseImagePipelineResult({ images: [image], usage: { cost: 0.02 } }, 'mock', 'mock'));
  assert.throws(() => parseImagePipelineResult({ images: [{ image_url: { url: 'data:image/png;base64,iVBORw0KGgo=' } }] }, 'mock', 'mock'));
});
