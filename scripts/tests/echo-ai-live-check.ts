/**
 * Explicit, internal, read-only live check. Never imported by app startup.
 * --live: at most three free-model requests using Mar's actual base profile.
 * --owner-id <id>: instead read that explicitly selected owner's saved universe.
 * Omitting owner avoids guessing between private universes.
 */
import assert from 'node:assert/strict';
import { createRequire } from 'node:module';
import { createSeedState } from '../../artifacts/echo/src/store/seed';
import { OpenRouterProvider } from '../../artifacts/api-server/src/ai-engine/openrouter';
import { previewDecision } from '../../artifacts/api-server/src/ai-engine/engine';
import { readUniverse } from '../../artifacts/api-server/src/lib/universeRepository';
const serverRequire = createRequire(new URL('../../artifacts/api-server/package.json', import.meta.url));
const { SaveUniverseBody } = serverRequire('@workspace/api-zod');
const { pool } = serverRequire('@workspace/db');

if (!process.argv.includes('--live')) throw Error('Pass --live explicitly to allow three free-model requests.');
const at = process.argv.indexOf('--owner-id');
const ownerId = at >= 0 ? process.argv[at + 1] : undefined;
if (at >= 0 && (!ownerId || ownerId.startsWith('--'))) throw Error('Missing owner id.');
try {
  const snapshot = ownerId ? await readUniverse(ownerId) : { state: createSeedState(), revision: 0 };
  const parsed = SaveUniverseBody.parse({ state: snapshot.state, expectedRevision: snapshot.revision });
  const state = parsed.state;
  const before = JSON.stringify(state);
  const post = state.posts.find(p => p.commentsEnabled !== false);
  const recipient = state.characters.find(c => c.id === 'nela' && !c.archived);
  if (!post || !recipient || !state.characters.some(c => c.id === 'mar' && !c.archived)) throw Error('Mar or required targets are unavailable.');
  const modelAt = process.argv.indexOf('--model');
  const situationAt = process.argv.indexOf('--situation');
  const selected = situationAt >= 0 ? process.argv[situationAt + 1] : undefined;
  if (selected && !['post', 'comment', 'dm'].includes(selected)) throw Error('Invalid situation.');
  const provider = new OpenRouterProvider(modelAt >= 0 ? process.argv[modelAt + 1] : undefined);
  for (const situation of ['post', 'comment', 'dm'] as const) {
    if (selected && selected !== situation) continue;
    const preview = await previewDecision(provider, state, {
      characterId: 'mar', situation,
      ...(situation === 'comment' ? { postId: post.id } : {}),
      ...(situation === 'dm' ? { recipientId: recipient.id } : {}),
    }, snapshot.revision);
    assert.equal(preview.executed, false);
    assert.equal(JSON.stringify(state), before);
    console.log(JSON.stringify({ source: ownerId ? 'explicit_owner_saved_universe' : 'actual_ECHO_seed_profile_not_private_owner_data',
      mode: preview.mode, executed: preview.executed, model: preview.model, situation,
      decision: preview.decision, warnings: preview.warnings }));
  }
  if (ownerId) assert.equal((await readUniverse(ownerId)).revision, snapshot.revision, 'Universe changed concurrently; previews never write.');
} catch (error) {
  // Never print provider response bodies, prompts, credentials or owner identifiers.
  console.error(error instanceof Error && 'code' in error ? String(error.code) : 'LIVE_CHECK_FAILED');
  process.exitCode = 1;
} finally { await pool.end(); }
