/**
 * Explicit, persisted-only, read-only live validation. No seed/demo fallback.
 * Usage: --live --owner-id <selected-owner> [--character-id mar]
 * [--situation post|comment|dm] [--report generated-artifacts/ai-engine/report.json]
 * Owner selection is an operator action, never inferred across private universes.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { mkdir, writeFile } from 'node:fs/promises';
import { resolve, dirname } from 'node:path';
import { FreeModelProvider } from '../../artifacts/api-server/src/ai-engine/free-models';
import { previewForOwner } from '../../artifacts/api-server/src/ai-engine/service';
import { EngineError } from '../../artifacts/api-server/src/ai-engine/contracts';
import { readUniverse } from '../../artifacts/api-server/src/lib/universeRepository';
import type { SocialState } from '../../lib/api-zod/src/generated/types/socialState';
const serverRequire = createRequire(new URL('../../artifacts/api-server/package.json', import.meta.url));
const { SaveUniverseBody } = serverRequire('@workspace/api-zod');
const { pool } = serverRequire('@workspace/db');
const option = (name: string) => {
  const i = process.argv.indexOf(name);
  if (i < 0) return undefined;
  if (!process.argv[i + 1] || process.argv[i + 1].startsWith('--')) throw new EngineError('MISSING_OPTION_VALUE');
  return process.argv[i + 1];
};
const report: Record<string, unknown> = {
  source: 'persisted_owner_universe', providerResponses: 'real_only', executed: false,
  startedAt: new Date().toISOString(), scenarios: [],
};
let output: string | undefined;
try {
  if (!process.argv.includes('--live')) throw new EngineError('EXPLICIT_LIVE_FLAG_REQUIRED');
  const ownerId = option('--owner-id');
  if (!ownerId) throw new EngineError('EXPLICIT_OWNER_REQUIRED_NO_DEMO_FALLBACK');
  const characterId = option('--character-id') ?? 'mar';
  const selected = option('--situation');
  if (selected && !['post', 'comment', 'dm'].includes(selected)) throw new EngineError('INVALID_SITUATION');
  const outputArg = option('--report');
  if (outputArg) {
    output = resolve(outputArg);
    if (!output.startsWith(resolve('../generated-artifacts/ai-engine') + '/')) throw new EngineError('REPORT_MUST_USE_IGNORED_PRIVATE_DIRECTORY');
  }
  const snapshot = await readUniverse(ownerId);
  const state = SaveUniverseBody.parse({ state: snapshot.state, expectedRevision: snapshot.revision }).state as SocialState;
  const actor = state.characters.find(c => c.id === characterId && !c.archived);
  if (!actor) throw new EngineError('PERSISTED_CHARACTER_NOT_FOUND');
  // Do not pass tests against an empty/default personality off as deep-character E2E.
  if (!actor.configuration || !(actor.configuration.personality.description.trim() || actor.configuration.personality.traits.length))
    throw new EngineError('PERSISTED_DEEP_PERSONALITY_REQUIRED_NO_SYNTHETIC_ENRICHMENT');
  report.characterId = actor.id;
  report.sourceRevision = snapshot.revision;
  const before = JSON.stringify(snapshot.state);
  const provider = new FreeModelProvider();
  const scenarios = report.scenarios as Record<string, unknown>[];
  for (const situation of ['post', 'comment', 'dm'] as const) {
    if (selected && selected !== situation) continue;
    const fresh = await readUniverse(ownerId);
    const current = SaveUniverseBody.parse({ state: fresh.state, expectedRevision: fresh.revision }).state as SocialState;
    const post = [...current.posts].filter(p => p.authorId !== actor.id && p.commentsEnabled !== false)
      .sort((a, b) => +new Date(b.createdAt) - +new Date(a.createdAt))[0];
    const recipient = current.characters.find(c => c.id === 'nela' && c.id !== actor.id && !c.archived)
      ?? current.characters.find(c => c.id !== actor.id && !c.archived);
    const input = { characterId, situation,
      ...(situation === 'comment' && post ? { postId: post.id } : {}),
      ...(situation === 'dm' && recipient ? { recipientId: recipient.id } : {}) };
    try {
      // Scope, audit and hash exactly the snapshot the service consumes.
      const captured = { state: fresh.state, revision: fresh.revision };
      const preview = await previewForOwner(ownerId, input, {
        read: async id => {
          assert.equal(id, ownerId);
          return captured;
        }, provider,
      });
      assert.equal(preview.executed, false);
      assert.equal(preview.contextAudit.source, 'persisted_owner_universe');
      scenarios.push({ situation, status: 'success', ...preview });
    } catch (error) {
      scenarios.push({ situation, status: 'failure', code: error instanceof EngineError ? error.code : 'LIVE_CHECK_FAILED',
        attempts: error instanceof EngineError ? error.attempts ?? [] : [],
        contextAudit: error instanceof EngineError ? error.contextAudit ?? null : null });
      process.exitCode = 1;
    }
  }
  const after = await readUniverse(ownerId);
  report.universeUnchanged = after.revision === snapshot.revision && JSON.stringify(after.state) === before;
  if (!report.universeUnchanged) {
    // Another device may legitimately edit during the test: never restore/overwrite it.
    report.concurrentChangeDetected = true;
    process.exitCode = 1;
  }
} catch (error) {
  report.status = 'blocked';
  report.error = error instanceof EngineError ? error.code : 'LIVE_CHECK_FAILED';
  process.exitCode = 1;
} finally {
  report.finishedAt = new Date().toISOString();
  const serialized = JSON.stringify(report, null, 2);
  if (output) { await mkdir(dirname(output), { recursive: true }); await writeFile(output, serialized, { mode: 0o600 }); }
  console.log(serialized); // Private operator output, never a server log or public artifact.
  await pool.end();
}
