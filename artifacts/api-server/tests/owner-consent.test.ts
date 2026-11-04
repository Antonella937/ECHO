import assert from "node:assert/strict";
import { after, before, beforeEach, test } from "node:test";
import { once } from "node:events";
import { createServer, type Server } from "node:http";
import express, { type RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import { db, echoOwnerConsentsTable, echoUniversesTable, echoMediaTable, echoCreatorEntitlementsTable,
  echoCharacterPrivacyTable, echoCharacterFollowRequestsTable } from "@workspace/db";
import { createOwnerConsentRouter } from "../src/routes/owner-consent";
import { createConsentSafetyGate } from "../src/middlewares/consentSafety";
import { createUniverseSharingRouter } from "../src/routes/universe-sharing";
import { createCharacterPrivacyRouter } from "../src/routes/character-privacy";
import { createSocialFollowsRouter } from "../src/routes/social-follows";
import { ALPHA_CONSENT_VERSION } from "../src/lib/ownerConsent";

const owners = [`consent-stage03-${crypto.randomUUID()}`, `consent-stage03-${crypto.randomUUID()}`];
const [a, b] = owners;
const paths = [`/objects/consent-stage03-${crypto.randomUUID()}/a`, `/objects/consent-stage03-${crypto.randomUUID()}/b`];
const input = { version: ALPHA_CONSENT_VERSION, adultDeclared: true, fictionAcknowledged: true, legalDraftAcknowledged: true };
let server: Server;
let url = "";
let writes = 0;
let providers = 0;
const auth: RequestHandler = (req, res, next) => {
  const owner = req.header("x-test-owner");
  if (!owner || !owners.includes(owner)) { res.status(401).json({ error: "Unauthenticated" }); return; }
  req.userId = owner;
  next();
};
async function call(path: string, method = "GET", body?: unknown, owner: string | null = a) {
  return fetch(`${url}${path}`, { method, headers: { ...(owner ? { "x-test-owner": owner } : {}), "Content-Type": "application/json" },
    body: body === undefined ? undefined : JSON.stringify(body) });
}
async function acknowledge(owner = a) {
  const response = await call("/creator/consent", "PUT", input, owner);
  assert.equal(response.status, 200);
  return response.json();
}
async function cleanup() {
  assert.ok(owners.every(owner => /^consent-stage03-[a-f0-9-]{36}$/.test(owner)));
  await db.transaction(async tx => {
    await tx.delete(echoOwnerConsentsTable).where(inArray(echoOwnerConsentsTable.ownerId, owners));
    await tx.delete(echoMediaTable).where(inArray(echoMediaTable.ownerId, owners));
    await tx.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
    await tx.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, owners));
  });
}
before(async () => {
  const app = express();
  app.use(express.json());
  app.use((req, _res, next) => { const owner = req.header("x-test-owner"); if (owner && owners.includes(owner)) req.userId = owner; next(); });
  app.use(createConsentSafetyGate(req => req.userId));
  app.use(createOwnerConsentRouter(auth));
  app.use(createUniverseSharingRouter({ authenticate: auth }));
  app.use(createCharacterPrivacyRouter({ authenticate: auth }));
  app.use(createSocialFollowsRouter({ authenticate: auth }));
  app.post("/owner-write", auth, (_req, res) => { writes++; res.json({ simulated: true }); });
  app.post("/ai-engine/preview", auth, (_req, res) => { providers++; res.json({ simulated: true }); });
  app.get("/social/owners/:owner/universes/:universe/characters/:character", auth, (_req, res) => res.json({ ownerOnlyProbe: true }));
  app.get("/storage/objects/*path", auth, (_req, res) => res.send("synthetic-private-bytes"));
  app.get("/social/feed", auth, (_req, res) => res.json({ items: [{ secret: true }] }));
  server = createServer(app).listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address(); assert.ok(address && typeof address !== "string");
  url = `http://127.0.0.1:${address.port}`;
});
beforeEach(async () => {
  await cleanup();
  writes = 0; providers = 0;
  for (const owner of owners) for (const universeId of ["primary", "studio"]) {
    await db.insert(echoUniversesTable).values({ ownerId: owner, universeId, revision: 3, sharingEnabled: false,
      state: { characters: [{ id: "same-id", name: owner === a ? "Owner A" : "Owner B" }, { id: "other-id", name: "Otro personaje" }], posts: [], stories: [] } });
  }
  await db.insert(echoMediaTable).values(paths.map((objectPath, index) => ({ objectPath, ownerId: owners[index] })));
});
after(async () => {
  try { if (server) await new Promise<void>(resolve => server.close(() => resolve())); }
  finally {
    await cleanup();
    assert.equal((await db.select().from(echoOwnerConsentsTable).where(inArray(echoOwnerConsentsTable.ownerId, owners))).length, 0);
    assert.equal((await db.select().from(echoMediaTable).where(inArray(echoMediaTable.objectPath, paths))).length, 0);
  }
});
test("anonymous status/write are401", async () => {
  assert.equal((await call("/creator/consent", "GET", undefined, null)).status, 401);
  assert.equal((await call("/creator/consent", "PUT", input, null)).status, 401);
});
test("legacy owner defaults false without inferred acceptance or DB write", async () => {
  const status = await (await call("/creator/consent")).json();
  assert.equal(status.draftAcknowledged, false);
  assert.equal(status.adultDeclared, false);
  assert.equal(status.fictionAcknowledged, false);
  assert.equal(status.legalDraftAcknowledged, false);
  assert.equal(status.acknowledgedAt, null);
  assert.equal((await db.select().from(echoOwnerConsentsTable).where(eq(echoOwnerConsentsTable.ownerId, a))).length, 0);
});
for (const flag of ["adultDeclared", "fictionAcknowledged", "legalDraftAcknowledged"]) {
  test(`rejects unchecked ${flag} and preserves no acknowledgement`, async () => {
    assert.equal((await call("/creator/consent", "PUT", { ...input, [flag]: false })).status, 422);
    assert.equal((await (await call("/creator/consent")).json()).draftAcknowledged, false);
  });
}
test("rejects omitted flags, stale version, forged owner/timestamp/legal status", async () => {
  for (const body of [{ version: ALPHA_CONSENT_VERSION }, { ...input, version: "old" }, { ...input, ownerId: b },
    { ...input, acknowledgedAt: "2000-01-01" }, { ...input, legalConsentValid: true }, { ...input, externalUseAllowed: true }]) {
    assert.equal((await call("/creator/consent", "PUT", body)).status, 422);
  }
});
test("server timestamp and immutable idempotent acknowledgement, never legal acceptance", async () => {
  const first = await acknowledge();
  const [second, concurrent] = await Promise.all([acknowledge(), acknowledge()]);
  assert.equal(first.draftAcknowledged, true);
  assert.ok(Number.isFinite(Date.parse(first.acknowledgedAt)));
  assert.equal(first.acknowledgedAt, second.acknowledgedAt);
  assert.equal(first.acknowledgedAt, concurrent.acknowledgedAt);
  assert.equal(first.legalDocumentsAvailable, false);
  assert.equal(first.legalConsentValid, false);
  assert.equal(first.externalUseAllowed, false);
  assert.equal((await db.select().from(echoOwnerConsentsTable).where(eq(echoOwnerConsentsTable.ownerId, a))).length, 1);
});
test("owner isolation and ignored forged query identity", async () => {
  await acknowledge(a);
  const other = await (await call(`/creator/consent?ownerId=${a}`, "GET", undefined, b)).json();
  assert.equal(other.draftAcknowledged, false);
  assert.equal(other.acknowledgedAt, null);
});
test("version history preserved; legacy version never unlocks current", async () => {
  await db.insert(echoOwnerConsentsTable).values({ ownerId: a, version: "alpha-draft-0", adultDeclared: true,
    fictionAcknowledged: true, legalDraftAcknowledged: true });
  assert.equal((await (await call("/creator/consent")).json()).draftAcknowledged, false);
  await acknowledge();
  assert.equal((await db.select().from(echoOwnerConsentsTable).where(eq(echoOwnerConsentsTable.ownerId, a))).length, 2);
});
test("owner mutation rejected before acknowledgement, allowed only as synthetic probe afterward", async () => {
  assert.equal((await call("/owner-write", "POST", {})).status, 403);
  assert.equal(writes, 0);
  await acknowledge();
  assert.equal((await call("/owner-write", "POST", {})).status, 200);
  assert.equal(writes, 1);
});
test("sharing enable rejected even after draft; disabling always allowed", async () => {
  assert.equal((await call("/universe/primary/sharing", "PUT", { sharingEnabled: false })).status, 200);
  await acknowledge();
  assert.equal((await call("/universe/primary/sharing", "PUT", { sharingEnabled: true })).status, 409);
  assert.equal((await (await call("/universe/primary/sharing")).json()).sharingEnabled, false);
  assert.equal((await call("/universe/does-not-exist/sharing")).status, 404);
});
test("no provider invocation despite draft acknowledgement", async () => {
  await acknowledge();
  assert.equal((await call("/ai-engine/preview", "POST", {})).status, 409);
  assert.equal(providers, 0);
});
test("cross-owner direct URL/feed and media fail without bytes even if historical sharing is ON", async () => {
  await acknowledge();
  await db.update(echoUniversesTable).set({ sharingEnabled: true }).where(eq(echoUniversesTable.ownerId, b));
  assert.equal((await call(`/social/owners/${b}/universes/studio/characters/same-id`)).status, 404);
  assert.equal((await call("/social/feed")).status, 404);
  const denied = await call(`/storage${paths[1]}`);
  assert.equal(denied.status, 404);
  assert.equal((await denied.text()).includes("synthetic-private-bytes"), false);
  assert.equal((await call(`/storage${paths[0]}`)).status, 200);
});
test("cross-owner follow mutation blocked and no privacy defaults written", async () => {
  await acknowledge();
  const response = await call("/social/follows", "POST", {
    sourceUniverseId: "primary", sourceCharacterId: "same-id", targetOwnerId: b,
    targetUniverseId: "primary", targetCharacterId: "same-id",
  });
  assert.equal(response.status, 404);
  assert.equal((await db.select().from(echoCharacterPrivacyTable).where(inArray(echoCharacterPrivacyTable.ownerId, owners))).length, 0);
});
test("request list filters external identities before100 and retains own-universe requests", async () => {
  await acknowledge();
  const internal = crypto.randomUUID();
  await db.insert(echoCharacterFollowRequestsTable).values([
    { id: internal, sourceOwnerId: a, sourceUniverseId: "primary", sourceCharacterId: "other-id",
      targetOwnerId: a, targetUniverseId: "primary", targetCharacterId: "same-id", status: "pending", createdAt: new Date(0) },
    ...Array.from({ length: 101 }, (_, i) => ({
      id: crypto.randomUUID(), sourceOwnerId: b, sourceUniverseId: "primary", sourceCharacterId: `external-${i}`,
      targetOwnerId: a, targetUniverseId: "primary", targetCharacterId: "same-id", status: "pending" as const,
    })),
  ]);
  const response = await call("/social/follow-requests?universeId=primary&direction=incoming&status=all");
  assert.equal(response.status, 200);
  const body = await response.json();
  assert.equal(body.requests.length, 1);
  assert.equal(body.requests[0].requestId, internal);
  assert.equal(JSON.stringify(body).includes(b), false);
});
test("real visibility route owner/universe persistence and denial; archived universe inaccessible", async () => {
  await acknowledge();
  assert.equal((await call("/character-privacy/same-id/visibility?universeId=studio", "PUT", { visibility: "private" })).status, 200);
  assert.equal((await (await call("/character-privacy/same-id/visibility?universeId=studio")).json()).visibility, "private");
  assert.equal((await (await call("/character-privacy/same-id/visibility?universeId=primary")).json()).visibility, "public");
  assert.equal((await (await call("/character-privacy/same-id/visibility?universeId=studio", "GET", undefined, b)).json()).visibility, "public");
  assert.equal((await call("/character-privacy/missing/visibility?universeId=studio")).status, 404);
  await db.update(echoUniversesTable).set({ archivedAt: new Date() }).where(and(eq(echoUniversesTable.ownerId, a), eq(echoUniversesTable.universeId, "studio")));
  assert.equal((await call("/character-privacy/same-id/visibility?universeId=studio")).status, 404);
  assert.equal((await call("/universe/studio/sharing")).status, 404);
});
