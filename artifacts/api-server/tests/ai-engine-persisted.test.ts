/** Real PostgreSQL, isolated synthetic test owners. NOT a live character/AI result. */
import test, { after } from 'node:test';
import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { pool } from '@workspace/db';
import { cleanupDisposableOwners } from './helpers/cleanup-disposable-owners';
import { createSeedState } from '../../echo/src/store/seed';
import { defaultCharacterConfig } from '../../echo/src/domain/character-core';
import { readUniverse, writeUniverse } from '../src/lib/universeRepository';
import { previewForOwner } from '../src/ai-engine/service';
import { FreeModelProvider } from '../src/ai-engine/free-models';
import type { TextProvider } from '../src/ai-engine/contracts';

after(async () => { await pool.end(); });

test('PostgreSQL: contexto profundo persistido, nueva revisión, aislamiento y 3 previews sin escrituras', async () => {
  const owners = [`ai-checkpoint-test-${crypto.randomUUID()}`, `ai-checkpoint-test-${crypto.randomUUID()}`];
  try {
    const state = createSeedState();
    state.currentCharacterId = 'noah'; // The actor is Mar, not the active identity.
    const mar = state.characters.find(c => c.id === 'mar')!;
    mar.configuration = defaultCharacterConfig(mar);
    mar.configuration.personality.description = 'PERSISTED_PERSONALITY_A_NOT_A_SEED';
    mar.configuration.voice.speakingStyle = 'Directa y pausada';
    mar.configuration.routine.timezone = 'America/Argentina/Buenos_Aires';
    mar.configuration.currentState.mood = 'Serena, dato de prueba persistido';
    mar.configuration.relationships = [{ id: 'r-test', targetId: 'nela', preset: 'friend',
      customLabel: '', description: 'Amistad de prueba guardada', closeness: 60, trust: 70, attraction: 0, tension: 0 }];
    const other = structuredClone(state);
    other.characters.find(c => c.id === 'mar')!.configuration!.personality.description = 'OTHER_OWNER_PRIVATE_SENTINEL';
    await writeUniverse(owners[0], state as unknown as Record<string, unknown>, 0);
    await writeUniverse(owners[1], other as unknown as Record<string, unknown>, 0);
    const original = await readUniverse(owners[0]);
    let captured = '';
    const provider: TextProvider = { name: 'mock-only-no-live-generation', complete: async input => {
      captured = input.context;
      const context = JSON.parse(input.context);
      return { model: 'mock:free', text: JSON.stringify({
        action: 'draft', situation: context.situation, text: context.personality.description,
        reason: 'Prueba determinista de lectura persistida.', suggestedDelayMinutes: 0, contextSections: ['personality'],
      }) };
    } };
    for (const situation of ['post', 'comment', 'dm'] as const) {
      const preview = await previewForOwner(owners[0], {
        characterId: 'mar', situation, ...(situation === 'comment' ? { postId: state.posts[0].id } : {}),
        ...(situation === 'dm' ? { recipientId: 'nela' } : {}),
      }, { read: readUniverse, provider });
      assert.equal(preview.decision.text, 'PERSISTED_PERSONALITY_A_NOT_A_SEED');
      assert.equal(preview.contextAudit.source, 'persisted_owner_universe');
      assert.equal(preview.sourceRevision, 1);
      assert.equal(preview.contextAudit.contextHash, createHash('sha256').update(captured).digest('hex'));
      assert.ok(preview.contextAudit.sections.find(s => s.name === 'personality')?.hasContent);
      assert.equal(captured.includes('OTHER_OWNER_PRIVATE_SENTINEL'), false);
      assert.equal(preview.executed, false);
      const ctx = JSON.parse(captured);
      assert.equal(ctx.currentState.mood, mar.configuration.currentState.mood);
      assert.equal(ctx.routine.timezone, mar.configuration.routine.timezone);
      assert.equal(ctx.voice.speakingStyle, mar.configuration.voice.speakingStyle);
      assert.equal(ctx.relationships[0].description, mar.configuration.relationships[0].description);
    }
    assert.deepEqual(await readUniverse(owners[0]), original);
    mar.configuration.personality.description = 'PERSISTED_PERSONALITY_UPDATED_BY_OWNER';
    await writeUniverse(owners[0], state as unknown as Record<string, unknown>, 1);
    const updated = await previewForOwner(owners[0], { characterId: 'mar', situation: 'post' }, { read: readUniverse, provider });
    assert.equal(updated.decision.text, mar.configuration.personality.description);
    assert.equal(updated.sourceRevision, 2);
    const isolated = await previewForOwner(owners[1], { characterId: 'mar', situation: 'post' }, { read: readUniverse, provider });
    assert.equal(isolated.decision.text, 'OTHER_OWNER_PRIVATE_SENTINEL');
    await assert.rejects(previewForOwner('nonexistent-test-owner', { characterId: 'mar', situation: 'post' }, { read: readUniverse, provider }), /UNIVERSE_NOT_FOUND/);
  } finally {
    await cleanupDisposableOwners(owners);
  }
});

test('motor revalida salidas antes de aceptar fallback, sin convertir errores en éxito simulado', async () => {
  const { SaveUniverseBody } = await import('@workspace/api-zod');
  const { previewDecision } = await import('../src/ai-engine/engine');
  const state = SaveUniverseBody.parse({ state: createSeedState(), expectedRevision: 0 }).state;
  let calls = 0;
  const p = new FreeModelProvider({
    discover: async () => ['first:free', 'second:free'].map(id => ({ id, jsonMode: false, disableReasoning: false })),
    create: model => ({ name: 'test-only', complete: async () => {
      calls++;
      return { model: model.id, text: calls === 1 ? '{"action":"publish"}' : JSON.stringify({
        action: 'none', situation: 'post', text: null, reason: 'No corresponde publicar en esta prueba.',
        suggestedDelayMinutes: 30, contextSections: ['identity'],
      }) };
    } }),
  });
  const preview = await previewDecision(p, state, { characterId: 'mar', situation: 'post' }, 0);
  assert.equal(calls, 2);
  assert.equal(preview.attempts[0].code, 'INVALID_MODEL_DECISION');
  assert.equal(preview.attempts[1].outcome, 'success');
  assert.equal(preview.contextAudit.source, 'provided_snapshot');
  assert.equal(preview.executed, false);
});

test('un fallo conserva el hash del contexto realmente usado, no una reconstrucción posterior', async () => {
  const { SaveUniverseBody } = await import('@workspace/api-zod');
  const { previewDecision } = await import('../src/ai-engine/engine');
  const { EngineError } = await import('../src/ai-engine/contracts');
  const state = SaveUniverseBody.parse({ state: createSeedState(), expectedRevision: 0 }).state;
  let exact = '';
  const p: TextProvider = { name: 'test', complete: async input => {
    exact = input.context;
    throw new EngineError('SIMULATED_PROVIDER_FAILURE', 502);
  } };
  await assert.rejects(previewDecision(p, state, { characterId: 'mar', situation: 'post' }, 19),
    (e: InstanceType<typeof EngineError>) => e.contextAudit?.contextHash === createHash('sha256').update(exact).digest('hex')
      && e.contextAudit?.sourceRevision === 19);
});
