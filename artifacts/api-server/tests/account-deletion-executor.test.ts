import assert from "node:assert/strict";
import { test } from "node:test";
import { executeIsolatedDeletion, type DeletionAdapters } from "../src/lib/accountDeletionExecutor";

const a = "user_FictionalA", b = "user_FictionalB";
const fileA = "/objects/uploads/11111111-1111-4111-8111-111111111111";
const fileB = "/objects/uploads/22222222-2222-4222-8222-222222222222";

function fakeProviders() {
  const media = new Map([[a, new Set([fileA])], [b, new Set([fileB])]]);
  const database = new Set([a, b]);
  const identities = new Set([a, b]);
  const events: string[] = [];
  const adapters: DeletionAdapters = {
    async removeMedia(path) {
      events.push("media:" + path);
      if (!media.get(a)?.delete(path)) throw new Error("UNEXPECTED_FILE");
    },
    async removeDatabaseOwner(owner) { events.push("db:" + owner); database.delete(owner); },
    async removeIdentity(owner) { events.push("identity:" + owner); identities.delete(owner); },
  };
  return { media, database, identities, events, adapters };
}

test("deletes only fictional A, preserving fictional B", async () => {
  const f = fakeProviders();
  assert.deepEqual(await executeIsolatedDeletion(a, [{ ownerId: a, objectPath: fileA }], f.adapters), { status: "COMPLETED", mediaDeleted: 1 });
  assert.equal(f.media.get(a)?.size, 0);
  assert.deepEqual([...f.media.get(b)!], [fileB]);
  assert.equal(f.database.has(a), false);
  assert.equal(f.identities.has(a), false);
  assert.equal(f.database.has(b), true);
  assert.equal(f.identities.has(b), true);
  assert.deepEqual(f.events, ["media:" + fileA, "db:" + a, "identity:" + a]);
});

test("mixed owners fail before any provider call", async () => {
  const f = fakeProviders();
  await assert.rejects(executeIsolatedDeletion(a, [{ ownerId: a, objectPath: fileA }, { ownerId: b, objectPath: fileB }], f.adapters), /CROSS_OWNER_MEDIA/);
  assert.deepEqual(f.events, []);
});

test("media deletion failure stops database and identity deletion", async () => {
  const f = fakeProviders();
  f.adapters.removeMedia = async () => { throw new Error("STORAGE_FAILURE"); };
  await assert.rejects(executeIsolatedDeletion(a, [{ ownerId: a, objectPath: fileA }], f.adapters), /STORAGE_FAILURE/);
  assert.equal(f.database.has(a), true);
  assert.equal(f.identities.has(a), true);
});

test("database failure prevents identity deletion and does not claim completion", async () => {
  const f = fakeProviders();
  f.adapters.removeDatabaseOwner = async () => { throw new Error("DB_FAILURE"); };
  await assert.rejects(executeIsolatedDeletion(a, [{ ownerId: a, objectPath: fileA }], f.adapters), /DB_FAILURE/);
  assert.equal(f.identities.has(a), true);
  assert.equal(f.database.has(b), true);
});
