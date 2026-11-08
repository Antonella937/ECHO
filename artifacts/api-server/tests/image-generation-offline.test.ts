import assert from 'node:assert/strict';
import test from 'node:test';
import { orchestrateImageGeneration } from '../src/lib/imageGenerationOrchestrator';
import { buildOpenRouterImageRequest } from '../src/lib/openRouterImageAdapter';
import { requestOpenRouterImage } from '../src/lib/openRouterImageTransport';

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

test('storage failure records the provider charge without losing the reservation', async () => {
  const events: string[] = [];
  await assert.rejects(orchestrateImageGeneration({
    reserve: async () => { events.push('reserve'); return { id: 'job_test' }; },
    generate: async () => { events.push('generate'); return { bytes: Buffer.from('fake-image'), mimeType: 'image/png', provider: context.provider, model: context.model, billedUsd: 0.02 }; },
    store: async () => { events.push('store'); throw Error('storage unavailable'); },
    settle: async (_id, outcome) => {
      events.push('settle:' + outcome.status);
      assert.equal(outcome.reportedCostUsd, 0.02);
    },
  }, context), /storage unavailable/);
  assert.deepEqual(events, ['reserve', 'generate', 'store', 'settle:failed']);
});

test('provider costs exceeding the reservation never store the image', async () => {
  const events: string[] = [];
  await assert.rejects(orchestrateImageGeneration({
    reserve: async () => { events.push('reserve'); return { id: 'job_test' }; },
    generate: async () => { events.push('generate'); return { bytes: Buffer.from('fake-image'), mimeType: 'image/png', provider: context.provider, model: context.model, billedUsd: 0.20 }; },
    store: async () => { events.push('store'); return 'unused'; },
    settle: async (_id, outcome) => { events.push('settle:' + outcome.status); },
  }, context), /IMAGE_COST_EXCEEDS_RESERVATION_OR_UNKNOWN/);
  assert.deepEqual(events, ['reserve', 'generate', 'settle:unknown']);
});

test('OpenRouter transport parses a generated PNG and reported USD cost without paid requests', async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  let called = 0;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    called++;
    assert.equal(String(url), 'https://openrouter.ai/api/v1/images');
    assert.equal(init?.method, 'POST');
    assert.equal(init?.headers && (init.headers as Record<string,string>).Authorization, 'Bearer offline-test-key');
    const body = JSON.parse(String(init?.body));
    assert.equal(body.model, 'qwen/qwen-image-2.1-turbo');
    assert.equal(body.resolution, '1K');
    assert.equal(body.n, 1);
    return new Response(JSON.stringify({
      data: [{ b64_json: png.toString('base64'), media_type: 'image/png' }],
      usage: { cost: 0.0184 },
    }), { status: 200, headers: { 'Content-Type': 'application/json' } });
  }) as typeof fetch;
  const result = await requestOpenRouterImage({apiKey:'offline-test-key',prompt:'A natural portrait',references:[],fetchImpl:fakeFetch});
  assert.equal(called,1);
  assert.equal(result.billedUsd,0.0184);
  assert.equal(result.mimeType,'image/png');
  assert.deepEqual(result.bytes,png);
});

test('OpenRouter transport rejects provider errors and never retries automatically', async () => {
  let called = 0;
  const fakeFetch = (async () => {called++;return new Response('quota exhausted',{status:402});}) as typeof fetch;
  await assert.rejects(requestOpenRouterImage({apiKey:'offline-test-key',prompt:'Portrait',references:[],fetchImpl:fakeFetch}),/IMAGE_PROVIDER_HTTP_402/);
  assert.equal(called,1);
});

test('OpenRouter transport rejects successful responses without a trustworthy cost', async () => {
  const png = Buffer.from([137,80,78,71,13,10,26,10,0,0,0,0]);
  const fakeFetch = (async () => new Response(JSON.stringify({data:[{b64_json:png.toString('base64'),media_type:'image/png'}]}),{status:200})) as typeof fetch;
  await assert.rejects(requestOpenRouterImage({apiKey:'offline-test-key',prompt:'Portrait',references:[],fetchImpl:fakeFetch}),/IMAGE_PROVIDER_COST_UNKNOWN/);
});
