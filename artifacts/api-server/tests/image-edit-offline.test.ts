import assert from 'node:assert/strict';
import test from 'node:test';
import { prepareImageEdit, validateImageEditReferences } from '../src/lib/imageEditPreparation';
import { buildOpenRouterImageRequest } from '../src/lib/openRouterImageAdapter';
import { orchestrateImageGeneration } from '../src/lib/imageGenerationOrchestrator';

const source = '/objects/uploads/00000000-0000-0000-0000-000000000001';
const identity = '/objects/uploads/00000000-0000-0000-0000-000000000002';
const bytes = Buffer.from([0xff, 0xd8, 0xff, 0xd9]);
const image = (path: string) => ({ path, bytes, mimeType: 'image/jpeg' as const });

test('edit source comes first and duplicate identity images are removed', () => {
  const plan = prepareImageEdit({ sourcePath: source, instruction: 'Change jacket to black', identityPaths: [identity, source, identity] });
  assert.deepEqual(plan.referencePaths, [source, identity]);
  assert.match(plan.prompt, /FIRST supplied image/);
  assert.match(plan.prompt, /Change jacket to black/);
  const refs = validateImageEditReferences(source, [image(source), image(identity)]);
  const payload = buildOpenRouterImageRequest(plan.prompt, refs);
  assert.equal(payload.input_references?.length, 2);
  assert.match(payload.input_references![0].image_url.url, /^data:image\/jpeg;base64,/);
});

test('rejects invalid edit sources and empty instructions before provider calls', () => {
  assert.throws(() => prepareImageEdit({ sourcePath: 'https://elsewhere.example/image.jpg', instruction: 'Change outfit', identityPaths: [] }), /INVALID_IMAGE_EDIT_SOURCE/);
  assert.throws(() => prepareImageEdit({ sourcePath: source, instruction: ' ', identityPaths: [] }), /INVALID_IMAGE_EDIT_INSTRUCTION/);
  assert.throws(() => validateImageEditReferences(source, [image(identity)]), /IMAGE_EDIT_SOURCE_MISSING/);
});

test('limits edit reference count to four, including source', () => {
  const paths = Array.from({ length: 8 }, (_, i) => '/objects/uploads/00000000-0000-0000-0000-' + String(i + 10).padStart(12, '0'));
  const plan = prepareImageEdit({ sourcePath: source, instruction: 'Change background', identityPaths: paths });
  assert.equal(plan.referencePaths.length, 4);
  assert.equal(plan.referencePaths[0], source);
});

test('mock editing charges zero external credits and settles budget reservation', async () => {
  const events: string[] = [];
  const plan = prepareImageEdit({ sourcePath: source, instruction: 'Change pose', identityPaths: [identity] });
  const refs = validateImageEditReferences(source, [image(source), image(identity)]);
  const result = await orchestrateImageGeneration({
    reserve: async () => { events.push('mock-reserve'); return { id: 'fake-edit' }; },
    generate: async ({ references }) => {
      events.push('mock-generate');
      assert.equal(references[0], refs[0]);
      return { bytes, mimeType: 'image/jpeg', provider: 'openrouter', model: 'qwen/qwen-image-2.1-turbo', billedUsd: 0 };
    },
    store: async () => { events.push('mock-store'); return source; },
    settle: async (_, outcome) => { events.push('mock-settle:' + outcome.status); },
  }, {
    ownerId: 'owner', universeId: 'primary', characterId: 'character',
    prompt: plan.prompt, style: 'natural', references: refs, provider: 'openrouter',
    model: 'qwen/qwen-image-2.1-turbo', maximumUsd: 0.10,
  });
  assert.equal(result.billedUsd, 0);
  assert.deepEqual(events, ['mock-reserve', 'mock-generate', 'mock-store', 'mock-settle:succeeded']);
});
