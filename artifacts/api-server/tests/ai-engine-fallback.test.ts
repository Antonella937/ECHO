import test from 'node:test';
import assert from 'node:assert/strict';
import { discoverFreeModels, FreeModelProvider } from '../src/ai-engine/free-models';
import { EngineError, ProviderFailure, type TextProvider } from '../src/ai-engine/contracts';
import { OpenRouterProvider } from '../src/ai-engine/openrouter';

const model = (id: string) => ({ id, jsonMode: true, disableReasoning: true });
const models = [model('a:free'), model('b:free'), model('c:free'), model('d:free')];
const input = { system: 'system', context: 'PRIVATE_CONTEXT_SENTINEL', outputSchema: {} };
const good = (id: string): TextProvider => ({ name: 'fake', complete: async () => ({
  text: '{"valid":true}', model: id, usage: { cost: 0, promptTokens: 20, completionTokens: 10 },
}) });
test('catálogo solo acepta precio cero verificado y texto; nunca usa un modelo pago', async () => {
  const entry = (id: string, prompt: unknown = '0') => ({
    id, pricing: { prompt, completion: '0' }, architecture: { input_modalities: ['text'], output_modalities: ['text'] },
    supported_parameters: ['response_format'],
  });
  const found = await discoverFreeModels(async () => Response.json({ data: [
    entry('ok:free'), entry('paid:free', '0.001'), { ...entry('unknown:free'), pricing: { completion: '0' } }, entry('paid/model', '0'),
    entry('content-safety:free'), { ...entry('request-price:free'), pricing: { prompt: '0', completion: '0', request: '1' } },
  ] }));
  assert.deepEqual(found.map(m => m.id), ['ok:free']);
  await assert.rejects(discoverFreeModels(async () => Response.json({ data: [{ id: 'missing:free', pricing: {} }] })), /NO_FREE_MODELS/);
});
test('fallback 429 y respuesta incompleta: cambia de modelo, conserva diagnósticos y no cambia contexto', async () => {
  const contexts: string[] = [];
  const p = new FreeModelProvider({ discover: async () => models, create: m => ({
    name: 'fake', complete: async request => {
      contexts.push(request.context);
      if (m.id === 'a:free') throw new ProviderFailure('OPENROUTER_RATE_LIMITED', 429, true, 60000);
      if (m.id === 'b:free') throw new ProviderFailure('PROVIDER_RESPONSE_TRUNCATED', 502, true);
      return good(m.id).complete(request);
    },
  }) });
  const completion = await p.complete(input);
  assert.equal(completion.model, 'c:free');
  assert.deepEqual(completion.attempts.map(a => a.outcome), ['failure', 'failure', 'success']);
  assert.deepEqual(contexts, [input.context, input.context, input.context]);
  assert.equal(completion.usage?.cost, 0);
  assert.equal(JSON.stringify(completion.attempts).includes(input.context), false);
});
test('JSON inválido también hace fallback; máximo tres solicitudes por preview', async () => {
  let calls = 0;
  const p = new FreeModelProvider({ discover: async () => models, create: m => ({
    name: 'fake', complete: async () => { calls++; return { text: 'broken', model: m.id }; },
  }) });
  await assert.rejects(p.complete({ ...input, validate: () => { throw new EngineError('INVALID_MODEL_JSON', 502); } }),
    (e: EngineError) => e.code === 'FREE_MODELS_EXHAUSTED_OR_COOLDOWN' && e.attempts?.length === 3);
  assert.equal(calls, 3);
});
test('cooldown respeta Retry-After sin reintentar el mismo modelo ni esperar en bucle', async () => {
  let now = 100000, failedCalls = 0;
  const p = new FreeModelProvider({ now: () => now, discover: async () => models.slice(0, 2), create: m =>
    m.id === 'a:free' ? { name: 'fake', complete: async () => { failedCalls++; throw new ProviderFailure('OPENROUTER_RATE_LIMITED', 429, true, 60000); } } : good(m.id) });
  await p.complete(input);
  const second = await p.complete(input);
  assert.equal(second.attempts[0].outcome, 'skipped');
  assert.equal(failedCalls, 1);
  now += 61000;
  await p.complete(input); assert.equal(failedCalls, 2);
});
test('401 y clave ausente fallan sin tormenta de reintentos; los errores no exponen contexto', async () => {
  let calls = 0;
  const p = new FreeModelProvider({ discover: async () => models, create: () => ({
    name: 'fake', complete: async () => { calls++; throw new ProviderFailure('OPENROUTER_REJECTED_REQUEST_HTTP_401', 502, false); },
  }) });
  await assert.rejects(p.complete(input), (e: EngineError) => e.attempts?.length === 1 && !JSON.stringify(e).includes(input.context));
  assert.equal(calls, 1);
});
test('sin capacidad devuelve 429 y Retry-After; la siguiente llamada no hace red durante cooldown', async () => {
  let calls = 0;
  const p = new FreeModelProvider({ now: () => 1000, discover: async () => models.slice(0, 2), create: () => ({
    name: 'fake', complete: async () => { calls++; throw new ProviderFailure('OPENROUTER_RATE_LIMITED', 429, true, 120000); },
  }) });
  for (let i = 0; i < 2; i++) await assert.rejects(p.complete(input),
    (e: EngineError) => e.status === 429 && e.retryAfterMs === 120000 && e.attempts?.length === 2);
  assert.equal(calls, 2);
});
test('transporte conserva costo desconocido como null y cancela errores sin filtrar cuerpos', async () => {
  const original = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-placeholder';
  try {
    const p = new OpenRouterProvider('a:free', async () => Response.json({
      model: 'a:free', choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    }));
    assert.deepEqual((await p.complete(input)).usage, { promptTokens: null, completionTokens: null, cost: null });
    const paid = new OpenRouterProvider('a:free', async () => Response.json({
      model: 'a:free', usage: { cost: 0.001 }, choices: [{ finish_reason: 'stop', message: { content: '{}' } }],
    }));
    await assert.rejects(paid.complete(input), /NONZERO_FREE_MODEL_COST/);
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = original;
  }
});
