import test, { after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, echoUniversesTable, echoCreatorEntitlementsTable } from '@workspace/db';
import { SaveUniverseBody } from '@workspace/api-zod';
import { readUniverse, writeUniverse } from '../src/lib/universeRepository';
import { universeAccountError } from '../src/lib/universeValidation';
import { createStarterUniverse } from '../../echo/src/store/create-starter-universe';

const owners = [`social-ordering-${crypto.randomUUID()}`, `social-ordering-${crypto.randomUUID()}`];
const wire = (state: unknown) => JSON.parse(JSON.stringify(state));
function fixture() {
  const s = createStarterUniverse({ plan: 'creator', universeName: 'Ordering fixture', displayName: 'Fixture', username: 'fixture', bio: '' });
  s.posts = [0, 1, 2, 3].map(i => ({ id: `p${i}`, authorId: 'nela', image: 'asset:account-default',
    caption: 'Fixture', location: '', createdAt: new Date().toISOString(), likes: [], savedBy: [],
    origin: 'user', illustrative: false, pinned: i < 3, ...(i < 3 ? { pinOrder: i } : {}) }));
  s.stories = [0, 1].map(i => ({ id: `s${i}`, authorId: 'nela', image: 'asset:account-default',
    caption: '', createdAt: '2020-01-01T00:00:00Z', seenBy: [], origin: 'user' }));
  s.highlights = [{ id: 'h0', authorId: 'nela', title: 'Collection', storyIds: ['s0', 's1'], order: 0, coverStoryId: 's1' }];
  return s;
}
async function cleanup() {
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await db.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, owners));
}
afterEach(cleanup);
after(async () => { try { await cleanup(); } finally { await pool.end(); } });
const valid = (state: unknown) => {
  const parsed = SaveUniverseBody.parse({ state, expectedRevision: 0 }).state;
  assert.equal(universeAccountError(parsed), null);
  return parsed;
};
test('PostgreSQL persists manual pin order, highlight order and selected cover without dropping fields', async () => {
  const state = valid(fixture());
  await writeUniverse(owners[0], state, 0);
  const read = await readUniverse(owners[0]);
  assert.deepEqual(read.state, wire(state));
  assert.deepEqual((read.state!.posts as any[]).slice(0, 3).map(p => p.pinOrder), [0, 1, 2]);
  assert.equal((read.state!.highlights as any[])[0].coverStoryId, 's1');
});
test('same entity IDs remain isolated across owners and universes, and archived data cannot be loaded', async () => {
  const primary = valid(fixture()), studio = structuredClone(primary), other = structuredClone(primary);
  studio.posts[0].pinOrder = 2; studio.posts[2].pinOrder = 0; studio.highlights![0].coverStoryId = 's0';
  other.highlights![0].title = 'Other owner';
  for (const [owner, id, s] of [[owners[0], 'primary', primary], [owners[0], 'studio', studio], [owners[1], 'primary', other]] as const)
    await writeUniverse(owner, valid(s), 0, id);
  assert.deepEqual((await readUniverse(owners[0], 'primary')).state, wire(primary));
  assert.deepEqual((await readUniverse(owners[0], 'studio')).state, wire(studio));
  assert.deepEqual((await readUniverse(owners[1])).state, wire(other));
  assert.equal((await readUniverse(owners[1], 'studio')).state, null);
  await db.update(echoUniversesTable).set({ archivedAt: new Date() }).where(eq(echoUniversesTable.ownerId, owners[0]));
  assert.equal((await readUniverse(owners[0])).state, null);
  await assert.rejects(writeUniverse(owners[0], primary, 1), /UNIVERSE_UNAVAILABLE/);
  await db.update(echoUniversesTable).set({ archivedAt: null }).where(eq(echoUniversesTable.ownerId, owners[0]));
  assert.deepEqual((await readUniverse(owners[0])).state, wire(primary));
});
test('backend rejects fourth pin and duplicate ranks without making a persistence write', async () => {
  const s = fixture();
  s.posts[3].pinned = true;
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state), null);
  s.posts[3].pinned = false; s.posts[1].pinOrder = 0;
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state), null);
  assert.equal((await readUniverse(owners[0])).revision, 0);
});
test('backend rejects invalid numeric order, cover outside membership and wrong-author Story references', () => {
  const s = fixture();
  s.posts[0].pinOrder = -1;
  assert.equal(SaveUniverseBody.safeParse({ state: s, expectedRevision: 0 }).success, false);
  s.posts[0].pinOrder = 0; s.highlights![0].order = 0.5;
  assert.equal(SaveUniverseBody.safeParse({ state: s, expectedRevision: 0 }).success, false);
  s.highlights![0].order = 0; s.highlights![0].storyIds = ['s0'];
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state), null);
  s.highlights![0].coverStoryId = 's0'; s.stories[0].authorId = 'missing-identity';
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state), null);
});
test('legacy data without ordering or cover fields stays valid and persists unchanged', async () => {
  const s = fixture();
  s.posts.forEach(p => delete p.pinOrder);
  delete s.highlights![0].order; delete s.highlights![0].coverStoryId;
  const parsed = valid(s);
  await writeUniverse(owners[0], parsed, 0);
  assert.deepEqual((await readUniverse(owners[0])).state, wire(parsed));
});
test('stale persistence revision does not overwrite a newer manual order', async () => {
  const first = valid(fixture());
  await writeUniverse(owners[0], first, 0);
  const next = structuredClone(first);
  next.posts[0].pinOrder = 2; next.posts[2].pinOrder = 0;
  await writeUniverse(owners[0], next, 1);
  const stale = await writeUniverse(owners[0], first, 1);
  assert.equal(stale, null);
  assert.deepEqual((await readUniverse(owners[0])).state, wire(next));
});
test('backend rejects unpinned ranks, duplicate collection positions and missing cover references', () => {
  const s = fixture();
  s.posts[3].pinOrder = 0;
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state), null);
  delete s.posts[3].pinOrder;
  s.highlights!.push({ ...s.highlights![0], id: 'h1', order: 0 });
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state), null);
  s.highlights![1].order = 1;
  s.highlights![0].coverStoryId = 'missing';
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state), null);
});
