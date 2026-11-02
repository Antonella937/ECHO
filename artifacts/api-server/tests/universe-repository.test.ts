import { test, after } from 'node:test';
import assert from 'node:assert/strict';
import { db, pool, echoUniversesTable } from '@workspace/db';
import { inArray } from 'drizzle-orm';
import { readUniverse, writeUniverse } from '../src/lib/universeRepository';
import { ObjectStorageService } from '../src/lib/objectStorage';
import { ObjectPermission } from '../src/lib/objectAcl';

const prefix = `echo-test-${crypto.randomUUID()}`;
const owners = [`${prefix}-a`, `${prefix}-b`];
after(async () => {
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await pool.end();
});
test('PostgreSQL: aislamiento por propietario y creación atómica', async () => {
  assert.equal((await readUniverse(owners[0])).revision, 0);
  assert.ok(await writeUniverse(owners[0], { posts: ['privado-a'] }, 0));
  assert.equal(await writeUniverse(owners[0], { posts: ['no reemplazar'] }, 0), null);
  assert.equal((await readUniverse(owners[1])).state, null);
  assert.ok(await writeUniverse(owners[1], { posts: ['privado-b'] }, 0));
  assert.deepEqual((await readUniverse(owners[0])).state, { posts: ['privado-a'] });
});
test('PostgreSQL: dos dispositivos con la misma revisión no pueden sobrescribirse', async () => {
  const version = (await readUniverse(owners[0])).revision;
  const results = await Promise.all([
    writeUniverse(owners[0], { posts: ['dispositivo-a'] }, version),
    writeUniverse(owners[0], { posts: ['dispositivo-b'] }, version),
  ]);
  assert.equal(results.filter(Boolean).length, 1);
  assert.equal((await readUniverse(owners[0])).revision, version + 1);
});
test('almacenamiento real: una foto conserva sus bytes y solo su propietario puede leerla', async () => {
  const storage = new ObjectStorageService();
  // A tiny test PNG, never a user's uploaded photo.
  const bytes = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+aPioAAAAASUVORK5CYII=', 'base64');
  const url = await storage.getObjectEntityUploadURL();
  const path = storage.normalizeObjectEntityPath(url);
  const uploaded = await fetch(url, { method: 'PUT', headers: { 'Content-Type': 'image/png' }, body: bytes });
  assert.ok(uploaded.ok, 'test image uploaded');
  const file = await storage.getObjectEntityFile(path);
  try {
    await storage.trySetObjectEntityAclPolicy(path, { owner: owners[0], visibility: 'private' });
    assert.equal(await storage.canAccessObjectEntity({ userId: owners[0], objectFile: file, requestedPermission: ObjectPermission.READ }), true);
    assert.equal(await storage.canAccessObjectEntity({ userId: owners[1], objectFile: file, requestedPermission: ObjectPermission.READ }), false);
    const downloaded = await storage.downloadObject(file);
    assert.ok(downloaded.ok);
    assert.deepEqual(Buffer.from(await downloaded.arrayBuffer()), bytes);
  } finally { await file.delete(); }
});
