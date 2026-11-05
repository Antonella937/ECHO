import assert from 'node:assert/strict';
import { test } from 'node:test';
import { orchestrateImageGeneration, type GenerationDependencies } from '../src/lib/imageGenerationOrchestrator';

const input = { ownerId: 'owner', universeId: 'primary', characterId: 'character', prompt: 'Portrait', style: 'natural' as const, references: [], provider: 'mock', model: 'mock', maximumUsd: 0.1 };
const result = { bytes: Buffer.from('mock'), mimeType: 'image/png' as const, provider: 'mock', model: 'mock', billedUsd: 0.02 };

test('reserves before generation and settles successful storage', async () => {
  const calls: string[] = [];
  const deps: GenerationDependencies = {
    reserve: async () => { calls.push('reserve'); return { id: 'job' }; },
    generate: async () => { calls.push('generate'); return result; },
    store: async () => { calls.push('store'); return '/objects/uploads/mock'; },
    settle: async (_, outcome) => { calls.push('settle:' + outcome.status); },
  };
  const output = await orchestrateImageGeneration(deps, input);
  assert.deepEqual(calls, ['reserve', 'generate', 'store', 'settle:succeeded']);
  assert.equal(output.billedUsd, 0.02);
});

test('never calls a provider when reservation is denied', async () => {
  let called = false;
  const deps: GenerationDependencies = {
    reserve: async () => { throw Error('NO_BUDGET'); },
    generate: async () => { called = true; return result; },
    store: async () => '/objects/uploads/mock',
    settle: async () => {},
  };
  await assert.rejects(orchestrateImageGeneration(deps, input), /NO_BUDGET/);
  assert.equal(called, false);
});

test('marks an ambiguous provider failure as unknown', async () => {
  let settled = '';
  const deps: GenerationDependencies = {
    reserve: async () => ({ id: 'job' }),
    generate: async () => { throw Error('TIMEOUT'); },
    store: async () => '/objects/uploads/mock',
    settle: async (_, outcome) => { settled = outcome.status; },
  };
  await assert.rejects(orchestrateImageGeneration(deps, input), /TIMEOUT/);
  assert.equal(settled, 'unknown');
});
