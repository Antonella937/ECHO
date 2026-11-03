import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveUniverseBody } from '@workspace/api-zod';
import { createSeedState } from '../../echo/src/store/seed';
import { defaultCharacterConfig } from '../../echo/src/domain/character-core';
import { buildCharacterContext } from '../src/ai-engine/context';
import { previewDecision } from '../src/ai-engine/engine';
import { previewForOwner } from '../src/ai-engine/service';
import { OpenRouterProvider } from '../src/ai-engine/openrouter';
import { EngineError, type TextProvider } from '../src/ai-engine/contracts';

function fixture() {
  const s = createSeedState(), mar = s.characters.find(c => c.id === 'mar')!;
  mar.configuration = defaultCharacterConfig(mar);
  mar.configuration.personality.description = 'Reservada y paciente; prueba de ficha editable';
  mar.configuration.voice.speakingStyle = 'Mensajes serenos sin exageraciones';
  mar.configuration.personality.boundaries = ['Nunca insultar'];
  mar.configuration.relationships = [{ id: 'relationship-owner', targetId: 'owner', preset: 'friend',
    customLabel: '', description: 'Confianza construida lentamente', closeness: 70, trust: 75, attraction: 0, tension: 0 }];
  mar.configuration.memory.permanent = [{ id: 'm-fact', text: 'El taller es mi lugar de trabajo', targetId: null, kind: 'manual',
    createdAt: new Date().toISOString(), updatedAt: new Date().toISOString(), sourceId: null, promotedTo: null }];
  s.messages.push({ id: 'visible', threadId: 'mar__nela', senderId: 'mar', recipientId: 'nela', text: 'Taller abierto mañana',
    createdAt: new Date().toISOString(), storyId: null, postId: null, readBy: ['mar'], origin: 'user' },
  { id: 'private', threadId: 'nela__noah', senderId: 'nela', recipientId: 'noah', text: 'UNRELATED_PRIVATE_SENTINEL',
    createdAt: new Date().toISOString(), storyId: null, postId: null, readBy: [], origin: 'user' });
  return SaveUniverseBody.parse({ state: s, expectedRevision: 7 }).state;
}
const result = (situation: 'post' | 'comment' | 'dm', extra: Record<string, unknown> = {}) => ({
  action: 'draft', situation, text: 'El taller sigue abierto, entre barro y mañanas lentas.',
  reason: 'Su ocupación y personalidad favorecen un texto sereno.', suggestedDelayMinutes: 20,
  contextSections: ['identity', 'personality'], ...extra,
});
const provider = (value: unknown): TextProvider => ({ name: 'test-only', complete: async () => ({ text: JSON.stringify(value), model: 'fake:free' }) });

test('Mar usa ficha real completa, no archivos ni conversaciones privadas ajenas; no muta estado', () => {
  const s = fixture(), before = structuredClone(s);
  const built = buildCharacterContext(s, { characterId: 'mar', situation: 'dm', recipientId: 'nela' });
  const context = JSON.parse(built.serialized);
  assert.equal(context.identity.occupation, 'Ceramista');
  assert.match(context.personality.description, /Reservada/);
  assert.match(context.voice.speakingStyle, /serenos/);
  assert.equal(context.relationships[0].target.role, 'universe_owner_not_active_character');
  assert.equal(context.memory.permanent[0].text, 'El taller es mi lugar de trabajo');
  for (const name of ['routine', 'social', 'currentState', 'recentSocial']) assert.ok(context[name]);
  assert.equal(context.recentSocial.messages[0].id, 'visible');
  assert.equal(built.serialized.includes('UNRELATED_PRIVATE_SENTINEL'), false);
  assert.equal(built.serialized.includes('/objects/'), false);
  assert.equal(built.serialized.includes('referenceImages'), false);
  assert.deepEqual(s, before);
});
test('contexto sin ficha profunda es explícito y nunca inventa personalidad', () => {
  const s = fixture(); delete s.characters.find(c => c.id === 'mar')!.configuration;
  const built = buildCharacterContext(s, { characterId: 'mar', situation: 'post' });
  assert.ok(built.warnings.length);
  assert.equal(JSON.parse(built.serialized).personality, null);
  assert.equal(built.availableSections.includes('personality'), false);
});
test('post, comentario y DM devuelven solo propuestas estructuradas y no escriben', async () => {
  const s = fixture(), before = structuredClone(s);
  for (const situation of ['post', 'comment', 'dm'] as const) {
    let actualContext = '';
    const fake: TextProvider = { name: 'test-only', complete: async input => {
      actualContext = input.context;
      assert.match(input.system, /UNTRUSTED DATA/);
      return { text: JSON.stringify(result(situation)), model: 'fake:free' };
    } };
    const preview = await previewDecision(fake, s, { characterId: 'mar', situation,
      ...(situation === 'comment' ? { postId: s.posts[0].id } : {}), ...(situation === 'dm' ? { recipientId: 'nela' } : {}) }, 7);
    assert.equal(preview.executed, false); assert.equal(preview.mode, 'preview'); assert.equal(preview.sourceRevision, 7);
    assert.match(actualContext, /Ceramista/);
    assert.equal(preview.decision.situation, situation);
  }
  assert.deepEqual(s, before);
});
test('no hacer nada es válido sin texto y sin programación', async () => {
  const preview = await previewDecision(provider(result('post', { action: 'none', text: null })), fixture(),
    { characterId: 'mar', situation: 'post' }, 1);
  assert.equal(preview.decision.action, 'none'); assert.equal(preview.decision.text, null); assert.equal(preview.executed, false);
});
test('normaliza none con texto vacío a null, sin convertirlo en una publicación', async () => {
  const preview = await previewDecision(provider(result('post', { action: 'none', text: '  ' })), fixture(),
    { characterId: 'mar', situation: 'post' }, 1);
  assert.equal(preview.decision.action, 'none');
  assert.equal(preview.decision.text, null);
  assert.equal(preview.executed, false);
});
test('permite borrador de post válido con personaje sin ficha profunda', async () => {
  const s = fixture();
  delete s.characters.find(c => c.id === 'mar')!.configuration;
  const draft = result('post', { contextSections: ['identity', 'recentSocial'], text: 'Un rato tranquilo en Cadaqués.' });
  const preview = await previewDecision(provider(draft), s, { characterId: 'mar', situation: 'post' }, 1);
  assert.equal(preview.decision.action, 'draft');
  assert.equal(preview.decision.text, 'Un rato tranquilo en Cadaqués.');
  assert.deepEqual(preview.availableContextSections, ['identity', 'recentSocial']);
});
test('diagnostica cada inconsistencia semántica sin conservar la salida del modelo', async () => {
  const s = fixture(), input = { characterId: 'mar', situation: 'post' as const };
  const cases: Array<{ value: unknown; diagnostic: string; state?: ReturnType<typeof fixture> }> = [
    { value: result('dm'), diagnostic: 'SITUATION_MISMATCH' },
    { value: result('post', { action: 'none', text: 'Aun así publica' }), diagnostic: 'NONE_TEXT_NOT_NULL' },
    { value: result('post', { text: '   ' }), diagnostic: 'DRAFT_TEXT_EMPTY' },
    { value: result('post', { text: 'x'.repeat(601) }), diagnostic: 'DRAFT_TEXT_LIMIT_EXCEEDED' },
    { value: result('post', { contextSections: ['identity', 'voice'] }), diagnostic: 'CONTEXT_SECTION_UNAVAILABLE' },
    { value: result('post', { contextSections: ['identity', 'identity'] }), diagnostic: 'DUPLICATE_CONTEXT_SECTION' },
    { value: result('post', { text: 'http://example.com/private' }), diagnostic: 'FORBIDDEN_URL_OR_SECRET_PATTERN' },
    { value: result('post', { text: '/objects/private-file' }), diagnostic: 'FORBIDDEN_URL_OR_SECRET_PATTERN' },
    { value: result('post', { reason: 'Credential sk-or-v1-never-log-this' }), diagnostic: 'FORBIDDEN_URL_OR_SECRET_PATTERN' },
  ];
  const unconfigured = fixture();
  delete unconfigured.characters.find(c => c.id === 'mar')!.configuration;
  cases.push({ value: result('post', { contextSections: ['identity', 'personality'] }),
    diagnostic: 'CONTEXT_SECTION_UNAVAILABLE', state: unconfigured });
  for (const item of cases) {
    const secretLikeOutput = JSON.stringify(item.value);
    const fake: TextProvider = { name: 'synthetic', complete: async request => {
      const text = secretLikeOutput;
      request.validate?.(text);
      return { text, model: 'synthetic:free' };
    } };
    await assert.rejects(previewDecision(fake, item.state ?? s, input, 1), (error: unknown) => {
      assert.ok(error instanceof EngineError);
      assert.equal(error.code, 'UNSAFE_OR_INCONSISTENT_DECISION', `case=${item.diagnostic}`);
      assert.equal(error.diagnostic, item.diagnostic);
      assert.equal(JSON.stringify(error).includes('never-log-this'), false);
      return true;
    });
  }
});
test('rechaza decisiones JSON estructuralmente inválidas y no ofrece herramientas', async () => {
  const s = fixture(), input = { characterId: 'mar', situation: 'post' as const };
  for (const invalid of [result('post', { tool: 'sendMessage' }),
    result('post', { action: 'publish' }), result('post', { suggestedDelayMinutes: -1 })]) {
    await assert.rejects(previewDecision(provider(invalid), s, input, 1), /INVALID_MODEL_DECISION/);
  }
  await assert.rejects(previewDecision({ name: 'bad', complete: async () => ({ text: '```json {} ```', model: 'bad:free' }) }, s, input, 1), /INVALID_MODEL_JSON/);
});
test('targets válidos, comentarios cerrados, archivados, mensajes ocultos e identidad aislada', () => {
  const s = fixture();
  assert.throws(() => buildCharacterContext(s, { characterId: 'missing', situation: 'post' }));
  assert.throws(() => buildCharacterContext(s, { characterId: 'mar', situation: 'dm', recipientId: 'mar' }));
  s.posts[0].commentsEnabled = false;
  assert.throws(() => buildCharacterContext(s, { characterId: 'mar', situation: 'comment', postId: s.posts[0].id }));
  s.messages[0].hiddenForIds = ['mar'];
  assert.equal(JSON.parse(buildCharacterContext(s, { characterId: 'mar', situation: 'dm', recipientId: 'nela' }).serialized).recentSocial.messages.length, 0);
  s.characters.find(c => c.id === 'mar')!.archived = true;
  assert.throws(() => buildCharacterContext(s, { characterId: 'mar', situation: 'post' }));
});
test('servicio lee solo el propietario autenticado y no llama al proveedor sin universo', async () => {
  let calls = 0;
  const fake: TextProvider = { name: 'test', complete: async () => { calls++; return { text: JSON.stringify(result('post')), model: 'fake:free' }; } };
  const s = fixture(), read = async (owner: string) => ({ state: owner === 'owner-a' ? s : null, revision: 7 });
  await assert.rejects(previewForOwner('', { characterId: 'mar', situation: 'post' }, { read, provider: fake }), /AUTHENTICATION/);
  await assert.rejects(previewForOwner('owner-b', { characterId: 'mar', situation: 'post' }, { read, provider: fake }), /UNIVERSE_NOT_FOUND/);
  assert.equal(calls, 0);
  await previewForOwner('owner-a', { characterId: 'mar', situation: 'post' }, { read, provider: fake });
  assert.equal(calls, 1);
});
test('adaptador solo permite modelos gratis; errores y respuestas truncadas no se convierten en borradores', async () => {
  assert.throws(() => new OpenRouterProvider('paid/model'), /FREE_MODEL_REQUIRED/);
  // No live credential: inject a temporary dummy credential solely in this process.
  const original = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = 'test-placeholder-not-a-secret';
  try {
    const reject = new OpenRouterProvider('openrouter/free', async () => new Response('provider private body', { status: 401 }));
    await assert.rejects(reject.complete({ system: '', context: '', outputSchema: {} }), /OPENROUTER_REJECTED/);
    const truncated = new OpenRouterProvider('openrouter/free', async () => Response.json({ choices: [{ finish_reason: 'length', message: { content: '{}' } }], model: 'test:free' }));
    await assert.rejects(truncated.complete({ system: '', context: '', outputSchema: {} }), /TRUNCATED/);
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY; else process.env.OPENROUTER_API_KEY = original;
  }
});
