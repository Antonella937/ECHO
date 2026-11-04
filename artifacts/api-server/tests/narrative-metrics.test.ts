import test, { before, after, afterEach } from 'node:test';
import assert from 'node:assert/strict';
import express from 'express';
import { createServer, type Server } from 'node:http';
import { once } from 'node:events';
import { eq, inArray } from 'drizzle-orm';
import { db, pool, echoUniversesTable, echoCreatorEntitlementsTable } from '@workspace/db';
import { SaveUniverseBody } from '@workspace/api-zod';
import universeRouter from '../src/routes/universe';
import { writeUniverse, readUniverse as readRawUniverse } from '../src/lib/universeRepository';
import { createStarterUniverse } from '../../echo/src/store/create-starter-universe';

const owners = [`narrative-metrics-${crypto.randomUUID()}`, `narrative-metrics-${crypto.randomUUID()}`];
let server: Server, base: string;
function fixture(views?: number | null) {
  const s = createStarterUniverse({ plan: 'creator', universeName: 'Narrative fixture', displayName: 'Fixture', username: 'fixture', bio: '' });
  s.characters.push({ ...structuredClone(s.characters[0]), id: 'mar', handle: 'other_fixture', name: 'Other' });
  s.stories = [{ id: 's0', authorId: 'nela', image: 'asset:account-default', caption: 'Synthetic only',
    createdAt: '2020-01-01T00:00:00Z', seenBy: ['mar'], origin: 'user', ...(views !== undefined ? { displayMetrics: { views } } : {}) }];
  return { ...s };
}
async function readUniverse(owner: string, universe = 'primary') {
  const snapshot = await readRawUniverse(owner, universe);
  return { ...snapshot, state: snapshot.state ? SaveUniverseBody.parse({ state: snapshot.state, expectedRevision: snapshot.revision }).state : null };
}
async function cleanup() {
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await db.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, owners));
  for (const owner of owners) {
    assert.equal((await db.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, owner))).length, 0);
    assert.equal((await db.select().from(echoCreatorEntitlementsTable).where(eq(echoCreatorEntitlementsTable.ownerId, owner))).length, 0);
  }
}
before(async () => {
  const app = express(); app.use(express.json());
  // Synthetic Clerk auth object in this private, ephemeral test server ONLY.
  // The production requireAuth middleware and real universe router remain unchanged.
  app.use((req, _res, next) => {
    const userId = typeof req.headers['x-test-owner'] === 'string' ? req.headers['x-test-owner'] : null;
    Object.assign(req, { auth: Object.assign(() => ({ userId, sessionId: userId ? 'synthetic-session' : null,
      tokenType: 'session_token' }), { [Symbol.for('@clerk/express.auth')]: true }) });
    next();
  });
  app.use('/api', universeRouter);
  server = createServer(app); server.listen(0, '127.0.0.1'); await once(server, 'listening');
  base = `http://127.0.0.1:${(server.address() as { port: number }).port}`;
});
afterEach(cleanup);
after(async () => { try { await cleanup(); } finally { server?.closeAllConnections(); if (server) await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); } });
async function put(owner: string | null, state: unknown, revision: number, universe = 'primary', extra = '') {
  return fetch(`${base}/api/universe?universeId=${universe}${extra}`, { method: 'PUT',
    headers: { 'content-type': 'application/json', ...(owner ? { 'x-test-owner': owner } : {}) },
    body: JSON.stringify({ state, expectedRevision: revision }) });
}
test('HTTP narrative base persists across reload; legacy has no invented base or viewers', async () => {
  const s = fixture(); await writeUniverse(owners[0], s, 0);
  assert.equal((await readUniverse(owners[0])).state!.stories[0].displayMetrics, undefined);
  s.stories[0].displayMetrics = { views: 500 };
  assert.equal((await put(owners[0], s, 1)).status, 200);
  const response = await fetch(`${base}/api/universe`, { headers: { 'x-test-owner': owners[0] } });
  assert.equal(response.status, 200); const body = await response.json();
  assert.equal(body.state.stories[0].displayMetrics.views, 500);
  assert.deepEqual(body.state.stories[0].seenBy, ['mar']);
});
test('HTTP anonymous base mutation is 401 and does not write', async () => {
  await writeUniverse(owners[0], fixture(), 0);
  assert.equal((await put(null, fixture(999), 1)).status, 401);
  assert.equal((await readUniverse(owners[0])).revision, 1);
});
test('HTTP validates numeric bounds before write; zero, max and null are accepted', async () => {
  await writeUniverse(owners[0], fixture(), 0);
  for (const views of [-1, 0.5, 1e12 + 1, '10']) {
    const s = JSON.parse(JSON.stringify(fixture())); s.stories[0].displayMetrics = { views };
    assert.equal((await put(owners[0], s, 1)).status, 400);
  }
  assert.equal((await readUniverse(owners[0])).revision, 1);
  let revision = 1;
  for (const views of [0, 1e12, null]) assert.equal((await put(owners[0], fixture(views), revision++)).status, 200);
});
test('HTTP ownerId spoofing never changes another owner, even with identical Story IDs', async () => {
  await writeUniverse(owners[0], fixture(10), 0);
  await writeUniverse(owners[1], fixture(20), 0);
  assert.equal((await put(owners[1], fixture(999), 1, 'primary', `&ownerId=${owners[0]}`)).status, 200);
  assert.equal((await readUniverse(owners[0])).state!.stories[0].displayMetrics?.views, 10);
  assert.equal((await readUniverse(owners[0])).revision, 1);
  assert.equal((await readUniverse(owners[1])).state!.stories[0].displayMetrics?.views, 999);
});
test('HTTP repeated IDs and base changes stay isolated between two universes of the same owner', async () => {
  await writeUniverse(owners[0], fixture(10), 0);
  await writeUniverse(owners[0], fixture(20), 0, 'studio');
  assert.equal((await put(owners[0], fixture(333), 1, 'studio')).status, 200);
  assert.equal((await readUniverse(owners[0])).state!.stories[0].displayMetrics?.views, 10);
  assert.equal((await readUniverse(owners[0], 'studio')).state!.stories[0].displayMetrics?.views, 333);
});
test('HTTP archived universe rejects edits and reads; restoration preserves its viewers and base', async () => {
  await writeUniverse(owners[0], fixture(50), 0);
  await db.update(echoUniversesTable).set({ archivedAt: new Date() }).where(eq(echoUniversesTable.ownerId, owners[0]));
  assert.equal((await put(owners[0], fixture(999), 1)).status, 409);
  assert.equal((await fetch(`${base}/api/universe`, { headers: { 'x-test-owner': owners[0] } })).status, 409);
  await db.update(echoUniversesTable).set({ archivedAt: null }).where(eq(echoUniversesTable.ownerId, owners[0]));
  assert.equal((await readUniverse(owners[0])).state!.stories[0].displayMetrics?.views, 50);
  assert.deepEqual((await readUniverse(owners[0])).state!.stories[0].seenBy, ['mar']);
});
test('HTTP stale revision cannot replace newer base or accumulated real viewers', async () => {
  await writeUniverse(owners[0], fixture(10), 0);
  const fresh = fixture(20);
  fresh.characters.push({ ...structuredClone(fresh.characters[0]), id: 'noah', handle: 'noah_fixture', name: 'Noah fixture' });
  fresh.stories[0].seenBy.push('noah');
  assert.equal((await put(owners[0], fresh, 1)).status, 200);
  assert.equal((await put(owners[0], fixture(30), 1)).status, 409);
  const final = await readUniverse(owners[0]);
  assert.equal(final.revision, 2); assert.equal(final.state!.stories[0].displayMetrics?.views, 20);
  assert.deepEqual(final.state!.stories[0].seenBy, ['mar', 'noah']);
});
