import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import { inArray } from "drizzle-orm";
import { db, echoUniversesTable } from "@workspace/db";
import { createUniverseSharingRouter } from "../src/routes/universe-sharing";

const owners = [
  `universe-sharing-test-${crypto.randomUUID()}`,
  `universe-sharing-test-${crypto.randomUUID()}`,
];
const [ownerA, ownerB] = owners;
let server: Server;
let baseUrl = "";

async function cleanup(): Promise<void> {
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
}

async function seedUniverse(ownerId: string, universeId: string, state: Record<string, unknown>) {
  // Omit sharingEnabled to exercise the database default used by new and legacy-shaped rows.
  await db.insert(echoUniversesTable).values({
    ownerId,
    universeId,
    revision: 7,
    state,
  });
}

function authHeaders(ownerId?: string): HeadersInit {
  return ownerId ? { "x-test-owner": ownerId } : {};
}

async function getSharing(ownerId: string | undefined, universeId: string) {
  return fetch(`${baseUrl}/universe/${encodeURIComponent(universeId)}/sharing`, {
    headers: authHeaders(ownerId),
  });
}

async function setSharing(ownerId: string | undefined, universeId: string, body: unknown) {
  return fetch(`${baseUrl}/universe/${encodeURIComponent(universeId)}/sharing`, {
    method: "PUT",
    headers: { ...authHeaders(ownerId), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

before(async () => {
  await cleanup();
  const app = express();
  app.use(express.json());
  const syntheticAuth: RequestHandler = (req, res, next) => {
    const ownerId = req.header("x-test-owner");
    if (!ownerId) {
      res.status(401).json({ error: "Authentication required" });
      return;
    }
    req.userId = ownerId;
    next();
  };
  app.use(createUniverseSharingRouter({ authenticate: syntheticAuth }));
  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

afterEach(cleanup);

after(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
});

test("new and legacy-shaped universe rows default sharingEnabled to false", async () => {
  await seedUniverse(ownerA, "primary", { marker: "existing-state" });
  await seedUniverse(ownerA, "studio", { marker: "new-universe-state" });

  for (const universeId of ["primary", "studio"]) {
    const response = await getSharing(ownerA, universeId);
    assert.equal(response.status, 200);
    assert.deepEqual(await response.json(), { universeId, sharingEnabled: false });
  }
  const rows = await db.select({
    universeId: echoUniversesTable.universeId,
    sharingEnabled: echoUniversesTable.sharingEnabled,
  }).from(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, [ownerA]));
  assert.deepEqual(rows.map((row) => row.sharingEnabled), [false, false]);
});

test("owner can persist the preference independently without changing universe state or revision", async () => {
  const originalState = { marker: "must-remain-unchanged", nested: { value: 3 } };
  await seedUniverse(ownerA, "primary", originalState);
  await seedUniverse(ownerA, "studio", { marker: "other-universe" });

  const enabled = await setSharing(ownerA, "primary", { sharingEnabled: true });
  assert.equal(enabled.status, 200);
  assert.deepEqual(await enabled.json(), { universeId: "primary", sharingEnabled: true });
  assert.deepEqual(await (await getSharing(ownerA, "primary")).json(), {
    universeId: "primary",
    sharingEnabled: true,
  });
  assert.deepEqual(await (await getSharing(ownerA, "studio")).json(), {
    universeId: "studio",
    sharingEnabled: false,
  });

  const rows = await db.select({
    universeId: echoUniversesTable.universeId,
    sharingEnabled: echoUniversesTable.sharingEnabled,
    revision: echoUniversesTable.revision,
    state: echoUniversesTable.state,
  }).from(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, [ownerA]));
  const primary = rows.find((row) => row.universeId === "primary");
  assert.equal(primary?.sharingEnabled, true);
  assert.equal(primary?.revision, 7);
  assert.deepEqual(primary?.state, originalState);
});

test("another owner cannot read or change a universe setting", async () => {
  await seedUniverse(ownerA, "studio", { marker: "private-owner-setting" });

  const read = await getSharing(ownerB, "studio");
  assert.equal(read.status, 404);
  assert.deepEqual(await read.json(), { error: "UNIVERSE_NOT_FOUND" });

  const write = await setSharing(ownerB, "studio", { sharingEnabled: true });
  assert.equal(write.status, 404);
  assert.deepEqual(await write.json(), { error: "UNIVERSE_NOT_FOUND" });

  const [row] = await db.select({ sharingEnabled: echoUniversesTable.sharingEnabled })
    .from(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, [ownerA]));
  assert.equal(row.sharingEnabled, false);
});

test("authentication, universe existence, and strict boolean input are enforced", async () => {
  const anonymousRead = await getSharing(undefined, "primary");
  assert.equal(anonymousRead.status, 401);
  const anonymousWrite = await setSharing(undefined, "primary", { sharingEnabled: true });
  assert.equal(anonymousWrite.status, 401);

  await seedUniverse(ownerA, "primary", { marker: "stable" });
  assert.equal((await getSharing(ownerA, "missing")).status, 404);
  assert.equal((await setSharing(ownerA, "missing", { sharingEnabled: true })).status, 404);
  assert.equal((await setSharing(ownerA, "primary", { sharingEnabled: "true" })).status, 400);
  assert.equal((await setSharing(ownerA, "primary", {
    sharingEnabled: true,
    ownerId: ownerA,
  })).status, 400);

  const [row] = await db.select({ sharingEnabled: echoUniversesTable.sharingEnabled })
    .from(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, [ownerA]));
  assert.equal(row.sharingEnabled, false);
});
