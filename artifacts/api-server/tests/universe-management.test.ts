import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, pool, echoUniversesTable, echoCreatorEntitlementsTable, echoCharacterPrivacyTable, echoAutonomyCharactersTable, echoAutonomyOwnersTable } from "@workspace/db";
import { createCreatorRouter } from "../src/routes/creator";
import { readUniverse, writeUniverse } from "../src/lib/universeRepository";
import { listLiveOptInTargets } from "../src/autonomy/repository";
import { SaveUniverseBody } from "@workspace/api-zod";

const owners = [`universe-management-${crypto.randomUUID()}`, `universe-management-${crypto.randomUUID()}`];
const [owner, other] = owners;
let server: Server;
let base = "";
const state = (name: string) => ({
  creatorSetup: { universeName: name, universeDescription: "Original", plan: "creator" },
  characters: [{ id: "nela", name: "Synthetic", memory: ["fixture memory"] }],
  posts: [{ id: "repeated" }], stories: [{ id: "repeated" }],
  comments: [{ id: "fixture-comment" }], messages: [{ id: "fixture-message" }],
});
const scope = (id: string) => and(eq(echoUniversesTable.ownerId, owner), eq(echoUniversesTable.universeId, id));
async function row(id = "primary") {
  return (await db.select().from(echoUniversesTable).where(scope(id)))[0];
}
async function cleanup() {
  await db.delete(echoAutonomyCharactersTable).where(inArray(echoAutonomyCharactersTable.ownerId, owners));
  await db.delete(echoAutonomyOwnersTable).where(inArray(echoAutonomyOwnersTable.ownerId, owners));
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await db.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, owners));
}
async function operation(action: string, extra: Record<string, unknown> = {}, id = "primary", identity: string | null = owner) {
  return fetch(`${base}/creator/universes/${id}/management`, {
    method: "PUT", headers: { "content-type": "application/json", ...(identity ? { "x-fixture-owner": identity } : {}) },
    body: JSON.stringify({ action, expectedRevision: 1, ...extra }),
  });
}
before(async () => {
  const app = express();
  app.use(express.json());
  const auth: RequestHandler = (req, res, next) => {
    const id = req.header("x-fixture-owner");
    if (!id) { res.status(401).json({ error: "Authentication required" }); return; }
    req.userId = id; next();
  };
  app.use(createCreatorRouter(auth));
  server = createServer(app); server.listen(0, "127.0.0.1"); await once(server, "listening");
  const address = server.address();
  assert(address && typeof address !== "string");
  base = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => {
  await cleanup();
  await db.insert(echoCreatorEntitlementsTable).values(owners.map(ownerId => ({ ownerId, plan: "creator" as const })));
  await db.insert(echoUniversesTable).values([
    { ownerId: owner, universeId: "primary", state: state("Primary") },
    { ownerId: owner, universeId: "studio", state: state("Studio") },
    { ownerId: other, universeId: "primary", state: state("Other owner") },
  ]);
});
afterEach(cleanup);
after(async () => { await cleanup(); await new Promise<void>(resolve => server.close(() => resolve())); await pool.end(); });

test("anonymous management is 401 without writes", async () => {
  assert.equal((await operation("archive", {}, "primary", null)).status, 401);
  assert.equal((await row()).revision, 1);
});
test("owner edits name/description persistently without changing social content or sharing", async () => {
  const before = await row();
  assert.equal((await operation("edit", { name: "  Renamed  ", description: "New description" })).status, 200);
  const saved = await row();
  assert.equal((saved.state.creatorSetup as { universeName: string }).universeName, "Renamed");
  assert.equal((saved.state.creatorSetup as { universeDescription: string }).universeDescription, "New description");
  assert.deepEqual(saved.state.characters, before.state.characters);
  for (const key of ["posts", "stories", "comments", "messages"]) assert.deepEqual(saved.state[key], before.state[key]);
  assert.equal(saved.sharingEnabled, before.sharingEnabled);
  assert.equal(saved.revision, 2);
  assert.deepEqual((await row("studio")).state, state("Studio"));
});
test("editing legacy metadata creates a complete valid setup without altering content", async () => {
  const legacy = { ...state("Legacy"), creatorSetup: undefined };
  await db.update(echoUniversesTable).set({ state: legacy }).where(scope("primary"));
  assert.equal((await operation("edit", { name: "Legacy renamed", description: "" })).status, 200);
  const saved = await row();
  assert.equal(SaveUniverseBody.shape.state.shape.creatorSetup.safeParse(saved.state.creatorSetup).success, true);
  assert.deepEqual(saved.state.characters, legacy.characters);
  assert.deepEqual(saved.state.messages, legacy.messages);
});
test("foreign owner and nonexistent universe are uniformly 404", async () => {
  assert.equal((await operation("edit", { name: "Attack" }, "studio", other)).status, 404);
  assert.equal((await operation("archive", {}, "missing")).status, 404);
  assert.equal((await row("studio")).revision, 1);
});
test("invalid values and client owner spoofing are rejected", async () => {
  for (const data of [{ name: "" }, { name: "x".repeat(61) }, { name: "Valid", ownerId: other }, { name: "Valid", description: "x".repeat(501) }]) {
    assert.equal((await operation("edit", data)).status, 400);
  }
});
test("stale revision never overwrites a newer edit", async () => {
  assert.equal((await operation("edit", { name: "New" })).status, 200);
  assert.equal((await operation("edit", { name: "Old" })).status, 409);
  assert.equal((await row()).revision, 2);
});
test("archive preserves every state field and excludes accidental reads", async () => {
  const before = await row();
  const response = await operation("archive");
  assert.equal(response.status, 200);
  assert.equal((await response.json()).fallbackUniverseId, "studio");
  assert.deepEqual((await row()).state, before.state);
  assert((await row()).archivedAt);
  assert.equal((await readUniverse(owner)).state, null);
});
test("restore makes exactly the archived content readable again", async () => {
  await operation("archive");
  assert.equal((await operation("restore", { expectedRevision: 2 })).status, 200);
  assert.deepEqual((await readUniverse(owner)).state, state("Primary"));
  assert.equal((await row()).archivedAt, null);
});
test("last available universe cannot be archived or deleted", async () => {
  await operation("archive", {}, "studio");
  assert.equal((await operation("archive")).status, 409);
  assert.equal((await operation("delete", { confirmationText: "ELIMINAR Primary" })).status, 409);
  assert.deepEqual((await row()).state, state("Primary"));
});
test("delete requires exact strong confirmation and matching revision", async () => {
  for (const confirmationText of ["", "Primary", "ELIMINAR Studio", "eliminar Primary"]) {
    assert.equal((await operation("delete", { confirmationText })).status, 400);
  }
  assert.equal((await operation("delete", { confirmationText: "ELIMINAR Primary", expectedRevision: 8 })).status, 409);
  assert.equal((await row()).deletedAt, null);
});
test("opening/listing then cancelling has no destructive request or effect", async () => {
  const before = await row();
  const response = await fetch(`${base}/creator/universes`, { headers: { "x-fixture-owner": owner } });
  assert.equal(response.status, 200);
  assert.deepEqual(await row(), before);
});
test("confirmed delete purges scoped content/dependents and preserves other universes/owners", async () => {
  await db.insert(echoCharacterPrivacyTable).values(["primary", "studio"].map(universeId => ({ ownerId: owner, universeId, characterId: "nela" })));
  await db.insert(echoAutonomyCharactersTable).values(["primary", "studio"].map(universeId => ({ ownerId: owner, universeId, characterId: "nela" })));
  const otherBefore = await db.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, other));
  assert.equal((await operation("delete", { confirmationText: "ELIMINAR Primary" })).status, 200);
  assert.deepEqual((await row()).state, {});
  assert((await row()).deletedAt);
  assert.deepEqual((await row("studio")).state, state("Studio"));
  assert.deepEqual(await db.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, other)), otherBefore);
  assert.equal((await db.select().from(echoCharacterPrivacyTable).where(eq(echoCharacterPrivacyTable.ownerId, owner))).length, 1);
  assert.equal((await db.select().from(echoAutonomyCharactersTable).where(eq(echoAutonomyCharactersTable.ownerId, owner))).length, 1);
  const list = await (await fetch(`${base}/creator/universes`, { headers: { "x-fixture-owner": owner } })).json();
  assert.deepEqual(list.map((item: { universeId: string }) => item.universeId), ["studio"]);
});
test("old clients cannot write or resurrect archived/deleted content", async () => {
  await operation("archive");
  await assert.rejects(writeUniverse(owner, state("Stale"), 2), /UNIVERSE_UNAVAILABLE/);
  await operation("delete", { expectedRevision: 2, confirmationText: "ELIMINAR Primary" });
  await assert.rejects(writeUniverse(owner, state("Stale"), 0), /UNIVERSE_UNAVAILABLE/);
  assert.deepEqual((await row()).state, {});
});
test("concurrent archive requests cannot remove the final available universe", async () => {
  const results = await Promise.all([operation("archive"), operation("archive", {}, "studio")]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 409]);
});
test("duplicate delete has one commit and cannot affect another universe", async () => {
  const results = await Promise.all([
    operation("delete", { confirmationText: "ELIMINAR Primary" }),
    operation("delete", { confirmationText: "ELIMINAR Primary" }),
  ]);
  assert.deepEqual(results.map(result => result.status).sort(), [200, 404]);
  assert.equal((await row()).revision, 2);
  assert.equal((await row("studio")).revision, 1);
});
test("archived universes cannot be selected by the worker even with prior opt-in", async () => {
  await db.insert(echoAutonomyOwnersTable).values({ ownerId: owner, killSwitchEngaged: false });
  await db.insert(echoAutonomyCharactersTable).values(["primary", "studio"].map(universeId => ({ ownerId: owner, universeId, characterId: "nela", enabled: true })));
  await operation("archive");
  const targets = (await listLiveOptInTargets()).filter(item => item.ownerId === owner);
  assert.deepEqual(targets.map(item => item.universeId), ["studio"]);
});
