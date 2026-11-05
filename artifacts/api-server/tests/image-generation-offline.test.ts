import assert from 'node:assert/strict';
import test from 'node:test';
import { orchestrateImageGeneration } from '../src/lib/imageGenerationOrchestrator';
import { buildOpenRouterImageRequest } from '../src/lib/openRouterImageAdapter';

const context = {
  ownerId: 'user_test', universeId: 'primary', characterId: 'char_test',
  prompt: 'A portrait in natural light', style: 'natural' as const,
  references: [], provider: 'openrouter', model: 'qwen/qwen-image-2.1-turbo',
  maximumUsd: 0.10,
};

test('image generation completes entirely offline with injected fakes', async () => {
  const events: string[] = [];
  const result = await orchestrateImageGeneration({
    reserve: async () => { events.push('reserve'); return { id: 'job_test' }; },
    generate: async () => {
      events.push('generate');
      return { bytes: Buffer.from('fake-image'), mimeType: 'image/png', provider: context.provider, model: context.model, billedUsd: 0.02 };
    },
    store: async () => { events.push('store'); return '/objects/uploads/00000000-0000-0000-0000-000000000001'; },
    settle: async (_id, outcome) => { events.push('settle:' + outcome.status); },
  }, context);
  assert.deepEqual(events, ['reserve', 'generate', 'store', 'settle:succeeded']);
  assert.equal(result.billedUsd, 0.02);
});

test('an ambiguous provider failure retains a pessimistic reservation', async () => {
  const events: string[] = [];
  await assert.rejects(orchestrateImageGeneration({
    reserve: async () => { events.push('reserve'); return { id: 'job_test' }; },
    generate: async () => { events.push('generate'); throw Error('provider timeout'); },
    store: async () => { events.push('store'); return 'unused'; },
    settle: async (_id, outcome) => { events.push('settle:' + outcome.status); },
  }, context), /provider timeout/);
  assert.deepEqual(events, ['reserve', 'generate', 'settle:unknown']);
});

test('provider request serialization does not make network calls', () => {
  const request = buildOpenRouterImageRequest('Portrait', []);
  assert.equal(request.model, context.model);
  assert.equal(request.n, 1);
  assert.equal(request.prompt, 'Portrait');
  assert.equal('input_references' in request, false);
});
