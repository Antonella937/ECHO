import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, echoCreatorEntitlementsTable, echoUniversesTable } from '@workspace/db';
import { writeUniverse } from '../src/lib/universeRepository';
import { cleanupDisposableOwners } from './helpers/cleanup-disposable-owners';

after(async () => { await pool.end(); });
const owner = () => `ai-checkpoint-test-${crypto.randomUUID()}`;
const snapshot = async (id: string) => ({
  universes: await db.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, id)),
  entitlement: await db.select().from(echoCreatorEntitlementsTable).where(eq(echoCreatorEntitlementsTable.ownerId, id)),
});

test('teardown exacto elimina entitlements y universos, es idempotente y preserva otro owner', async () => {
  const targets = [owner(), owner()], sentinel = owner();
  try {
    for (const id of [...targets, sentinel]) await writeUniverse(id, { posts: [`sentinel:${id}`] }, 0);
    const preserved = await snapshot(sentinel);
    assert.equal(preserved.entitlement.length, 1);
    assert.equal((await db.select().from(echoCreatorEntitlementsTable)
      .where(inArray(echoCreatorEntitlementsTable.ownerId, targets))).length, 2);
    await cleanupDisposableOwners(targets);
    await cleanupDisposableOwners(targets);
    for (const id of targets) assert.deepEqual(await snapshot(id), { universes: [], entitlement: [] });
    assert.deepEqual(await snapshot(sentinel), preserved);
  } finally { await cleanupDisposableOwners([...targets, sentinel]); }
});

test('finally limpia tras fallo y rechaza identidades no sintéticas antes de borrar', async () => {
  const target = owner(), sentinel = owner();
  try {
    await writeUniverse(target, { posts: ['failure-fixture'] }, 0);
    await writeUniverse(sentinel, { posts: ['untouched'] }, 0);
    const preserved = await snapshot(sentinel);
    await assert.rejects(async () => {
      try { throw new Error('SIMULATED_TEST_FAILURE'); }
      finally { await cleanupDisposableOwners([target]); }
    }, /SIMULATED_TEST_FAILURE/);
    assert.deepEqual(await snapshot(target), { universes: [], entitlement: [] });
    await assert.rejects(cleanupDisposableOwners([sentinel, 'user_not_a_disposable_test']), /DISPOSABLE_TEST_OWNER_REQUIRED/);
    await assert.rejects(cleanupDisposableOwners([]), /DISPOSABLE_TEST_OWNER_REQUIRED/);
    assert.deepEqual(await snapshot(sentinel), preserved);
  } finally { await cleanupDisposableOwners([target, sentinel]); }
});
