import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import { and, eq, inArray, or } from "drizzle-orm";
import {
  db,
  echoCharacterFollowRequestsTable,
  echoCharacterFollowsTable,
  echoCharacterPrivacyTable,
  echoCreatorEntitlementsTable,
  echoUniversesTable,
} from "@workspace/db";
import { setCharacterVisibility } from "../src/lib/characterPrivacy";
import { writeUniverse } from "../src/lib/universeRepository";
import { createSocialFollowsRouter } from "../src/routes/social-follows";

const owners = [
  `social-follows-test-${crypto.randomUUID()}`,
  `social-follows-test-${crypto.randomUUID()}`,
  `social-follows-test-${crypto.randomUUID()}`,
];
const [ownerA, ownerB, ownerC] = owners;
let server: Server;
let baseUrl = "";

type FollowBody = {
  sourceUniverseId: string;
  sourceCharacterId: string;
  targetOwnerId: string;
  targetUniverseId: string;
  targetCharacterId: string;
};

function makeBody(
  sourceUniverseId: string,
  sourceCharacterId: string,
  targetOwnerId: string,
  targetUniverseId: string,
  targetCharacterId: string,
): FollowBody {
  return { sourceUniverseId, sourceCharacterId, targetOwnerId, targetUniverseId, targetCharacterId };
}

async function cleanup(): Promise<void> {
  await db.delete(echoCharacterFollowRequestsTable).where(or(
    inArray(echoCharacterFollowRequestsTable.sourceOwnerId, owners),
    inArray(echoCharacterFollowRequestsTable.targetOwnerId, owners),
  ));
  await db.delete(echoCharacterFollowsTable).where(or(
    inArray(echoCharacterFollowsTable.sourceOwnerId, owners),
    inArray(echoCharacterFollowsTable.targetOwnerId, owners),
  ));
  await db.delete(echoCharacterPrivacyTable).where(inArray(echoCharacterPrivacyTable.ownerId, owners));
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await db.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, owners));
}

async function seedUniverse(
  ownerId: string,
  universeId: string,
  characterIds: string[],
  legacyFollows: Record<string, string[]> = {},
  sharingEnabled = false,
): Promise<void> {
  await db.insert(echoUniversesTable).values({
    ownerId,
    universeId,
    revision: 1,
    sharingEnabled,
    state: {
      creatorSetup: { plan: "free" },
      characters: characterIds.map((id) => ({ id })),
      follows: legacyFollows,
    },
  });
}

function authHeaders(ownerId?: string): HeadersInit {
  return ownerId ? { "x-test-owner": ownerId } : {};
}

async function sendFollow(ownerId: string | undefined, body: FollowBody, method = "POST") {
  return fetch(`${baseUrl}/social/follows`, {
    method,
    headers: { ...authHeaders(ownerId), "content-type": "application/json" },
    body: JSON.stringify(body),
  });
}

async function listRequests(
  ownerId: string | undefined,
  query = "",
) {
  return fetch(`${baseUrl}/social/follow-requests${query}`, { headers: authHeaders(ownerId) });
}

async function transition(
  ownerId: string | undefined,
  requestId: string,
  action: "accept" | "reject" | "cancel",
) {
  return fetch(`${baseUrl}/social/follow-requests/${requestId}/${action}`, {
    method: "POST",
    headers: authHeaders(ownerId),
  });
}

async function activeFollows(where: ReturnType<typeof and>): Promise<number> {
  return (await db.select().from(echoCharacterFollowsTable).where(where)).length;
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
  app.use(createSocialFollowsRouter({ authenticate: syntheticAuth }));
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

test("public follows are direct, idempotent, and distinguish repeated character IDs by universe", async () => {
  await seedUniverse(ownerA, "primary", ["nela", "same-id"]);
  await seedUniverse(ownerA, "studio", ["nela", "same-id"]);
  await seedUniverse(ownerB, "primary", ["target"], {}, true);
  await seedUniverse(ownerB, "studio", ["target"], {}, true);

  const primaryBody = makeBody("primary", "same-id", ownerB, "primary", "target");
  const [first, duplicate] = await Promise.all([
    sendFollow(ownerA, primaryBody),
    sendFollow(ownerA, primaryBody),
  ]);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  assert.deepEqual(await first.json(), { status: "following" });
  assert.deepEqual(await duplicate.json(), { status: "following" });

  const studioResponse = await sendFollow(
    ownerA,
    makeBody("studio", "same-id", ownerB, "studio", "target"),
  );
  assert.equal(studioResponse.status, 200);
  const targetRows = await db.select().from(echoCharacterFollowsTable).where(and(
    eq(echoCharacterFollowsTable.targetOwnerId, ownerB),
    eq(echoCharacterFollowsTable.targetCharacterId, "target"),
  ));
  assert.equal(targetRows.length, 2);
  assert.deepEqual(
    new Set(targetRows.map((row) => JSON.stringify([
      row.sourceUniverseId,
      row.targetUniverseId,
    ]))),
    new Set([JSON.stringify(["primary", "primary"]), JSON.stringify(["studio", "studio"])]),
  );
  assert.equal((await listRequests(ownerB)).status, 200);
  assert.equal(((await (await listRequests(ownerB)).json()).requests as unknown[]).length, 0);

  const removedPrimary = await sendFollow(ownerA, primaryBody, "DELETE");
  assert.deepEqual(await removedPrimary.json(), { removed: true });
  const repeatedUnfollow = await sendFollow(ownerA, primaryBody, "DELETE");
  assert.deepEqual(await repeatedUnfollow.json(), { removed: false });
  assert.equal(await activeFollows(and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowsTable.sourceUniverseId, "studio"),
    eq(echoCharacterFollowsTable.sourceCharacterId, "same-id"),
    eq(echoCharacterFollowsTable.targetOwnerId, ownerB),
    eq(echoCharacterFollowsTable.targetUniverseId, "studio"),
    eq(echoCharacterFollowsTable.targetCharacterId, "target"),
  )), 1);
});

test("private follow requests are deduplicated, owner-visible, and accept atomically", async () => {
  const legacy = { "legacy-follower": ["legacy-following"] };
  await seedUniverse(ownerA, "primary", ["nela", "source"], legacy);
  await seedUniverse(ownerB, "studio", ["nela", "private-target"], {}, true);
  await seedUniverse(ownerC, "primary", ["nela"]);
  await setCharacterVisibility(ownerB, "studio", "private-target", "private");
  const body = makeBody("primary", "source", ownerB, "studio", "private-target");

  const [first, duplicate] = await Promise.all([sendFollow(ownerA, body), sendFollow(ownerA, body)]);
  assert.equal(first.status, 200);
  assert.equal(duplicate.status, 200);
  const firstResult = await first.json();
  const duplicateResult = await duplicate.json();
  assert.equal(firstResult.status, "pending");
  assert.equal(duplicateResult.status, "pending");
  assert.equal(firstResult.requestId, duplicateResult.requestId);
  assert.equal(await activeFollows(and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowsTable.sourceUniverseId, "primary"),
    eq(echoCharacterFollowsTable.sourceCharacterId, "source"),
    eq(echoCharacterFollowsTable.targetOwnerId, ownerB),
    eq(echoCharacterFollowsTable.targetUniverseId, "studio"),
    eq(echoCharacterFollowsTable.targetCharacterId, "private-target"),
  )), 0);

  const requestRows = await db.select().from(echoCharacterFollowRequestsTable).where(and(
    eq(echoCharacterFollowRequestsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowRequestsTable.targetOwnerId, ownerB),
  ));
  assert.equal(requestRows.length, 1);
  const requestId = requestRows[0].id;
  assert.equal(((await (await listRequests(ownerB, "?direction=incoming")).json()).requests as unknown[]).length, 1);
  assert.equal(((await (await listRequests(ownerA, "?direction=outgoing")).json()).requests as unknown[]).length, 1);
  assert.equal(((await (await listRequests(ownerC)).json()).requests as unknown[]).length, 0);
  assert.equal((await transition(ownerA, requestId, "accept")).status, 404);

  assert.deepEqual(await (await transition(ownerB, requestId, "accept")).json(), { status: "accepted" });
  assert.deepEqual(await (await transition(ownerB, requestId, "accept")).json(), { status: "accepted" });
  assert.equal(await activeFollows(and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowsTable.targetOwnerId, ownerB),
  )), 1);
  const [savedRequest] = await db.select().from(echoCharacterFollowRequestsTable)
    .where(eq(echoCharacterFollowRequestsTable.id, requestId));
  assert.equal(savedRequest.status, "accepted");

  const [universe] = await db.select({ state: echoUniversesTable.state }).from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, ownerA),
    eq(echoUniversesTable.universeId, "primary"),
  ));
  assert.deepEqual(universe.state.follows, legacy);
});

test("reject and cancel are authorized, idempotent terminal transitions", async () => {
  await seedUniverse(ownerA, "primary", ["nela", "source"]);
  await seedUniverse(ownerB, "primary", ["nela", "reject-target", "cancel-target"], {}, true);
  await setCharacterVisibility(ownerB, "primary", "reject-target", "private");
  await setCharacterVisibility(ownerB, "primary", "cancel-target", "private");
  const rejectedResponse = await sendFollow(
    ownerA,
    makeBody("primary", "source", ownerB, "primary", "reject-target"),
  );
  const cancelledResponse = await sendFollow(
    ownerA,
    makeBody("primary", "source", ownerB, "primary", "cancel-target"),
  );
  const rejectedId = (await rejectedResponse.json()).requestId as string;
  const cancelledId = (await cancelledResponse.json()).requestId as string;

  assert.equal((await transition(ownerC, rejectedId, "reject")).status, 404);
  assert.deepEqual(await (await transition(ownerB, rejectedId, "reject")).json(), { status: "rejected" });
  assert.deepEqual(await (await transition(ownerB, rejectedId, "reject")).json(), { status: "rejected" });
  assert.equal((await transition(ownerB, cancelledId, "cancel")).status, 404);
  assert.deepEqual(await (await transition(ownerA, cancelledId, "cancel")).json(), { status: "cancelled" });
  assert.deepEqual(await (await transition(ownerA, cancelledId, "cancel")).json(), { status: "cancelled" });

  const terminalRows = await db.select().from(echoCharacterFollowRequestsTable)
    .where(inArray(echoCharacterFollowRequestsTable.id, [rejectedId, cancelledId]));
  assert.equal(terminalRows.length, 2);
  assert.deepEqual(new Set(terminalRows.map((row) => row.status)), new Set(["rejected", "cancelled"]));
  assert.equal(await activeFollows(eq(echoCharacterFollowsTable.sourceOwnerId, ownerA)), 0);
});

test("visibility changes affect new follows while existing accepted follows remain active", async () => {
  await seedUniverse(ownerA, "primary", ["nela", "source"]);
  await seedUniverse(ownerB, "primary", ["nela", "changing-target"], {}, true);
  await setCharacterVisibility(ownerB, "primary", "changing-target", "private");
  const body = makeBody("primary", "source", ownerB, "primary", "changing-target");

  const pending = await sendFollow(ownerA, body);
  const pendingResult = await pending.json();
  assert.equal(pendingResult.status, "pending");
  await setCharacterVisibility(ownerB, "primary", "changing-target", "public");
  assert.deepEqual(await (await sendFollow(ownerA, body)).json(), { status: "following" });
  const [requestAfterPublicSwitch] = await db.select().from(echoCharacterFollowRequestsTable)
    .where(eq(echoCharacterFollowRequestsTable.id, pendingResult.requestId));
  assert.equal(requestAfterPublicSwitch.status, "accepted");
  assert.equal(await activeFollows(and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowsTable.targetOwnerId, ownerB),
  )), 1);

  await setCharacterVisibility(ownerB, "primary", "changing-target", "private");
  assert.deepEqual(await (await sendFollow(ownerA, body)).json(), { status: "following" });
  assert.equal(await activeFollows(and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowsTable.targetOwnerId, ownerB),
  )), 1);
});

test("requests reject spoofed, self, missing, cross-owner and malformed identities safely", async () => {
  await seedUniverse(ownerA, "primary", ["nela", "owned"]);
  await seedUniverse(ownerA, "studio", ["nela", "studio-only"]);
  await seedUniverse(ownerB, "primary", ["nela", "target"], {}, true);

  assert.equal((await listRequests(undefined)).status, 401);
  assert.equal((await sendFollow(undefined, makeBody("primary", "owned", ownerB, "primary", "target"))).status, 401);
  assert.equal((await sendFollow(ownerC, makeBody("primary", "owned", ownerB, "primary", "target"))).status, 404);
  assert.equal((await sendFollow(ownerA, makeBody("primary", "owned", ownerC, "missing", "target"))).status, 404);
  assert.equal((await sendFollow(ownerA, makeBody("primary", "owned", ownerB, "primary", "missing"))).status, 404);
  assert.equal((await sendFollow(ownerA, makeBody("studio", "owned", ownerB, "primary", "target"))).status, 404);
  assert.equal((await sendFollow(ownerA, makeBody("primary", "owned", ownerA, "primary", "owned"))).status, 400);

  const spoofed = await fetch(`${baseUrl}/social/follows`, {
    method: "POST",
    headers: { ...authHeaders(ownerA), "content-type": "application/json" },
    body: JSON.stringify({
      ...makeBody("primary", "owned", ownerB, "primary", "target"),
      sourceOwnerId: ownerC,
    }),
  });
  assert.equal(spoofed.status, 400);
  assert.equal((await listRequests(ownerC, `?ownerId=${encodeURIComponent(ownerA)}`)).status, 400);
  assert.equal((await transition(ownerA, "not-a-uuid", "accept")).status, 400);
  assert.equal(await activeFollows(eq(echoCharacterFollowsTable.sourceOwnerId, ownerA)), 0);
});

test("deleting a character removes only its relational edges and preserves legacy follows", async () => {
  const legacy = { "legacy-character": ["legacy-target"] };
  await seedUniverse(ownerA, "primary", ["nela", "same-id"], legacy);
  await seedUniverse(ownerA, "studio", ["nela", "same-id"]);
  await seedUniverse(ownerB, "primary", ["nela", "public-target", "private-target"], {}, true);
  await setCharacterVisibility(ownerB, "primary", "private-target", "private");

  const primaryBody = makeBody("primary", "same-id", ownerB, "primary", "public-target");
  const studioBody = makeBody("studio", "same-id", ownerB, "primary", "private-target");
  assert.deepEqual(await (await sendFollow(ownerA, primaryBody)).json(), { status: "following" });
  const studioRequest = await sendFollow(ownerA, studioBody);
  assert.equal((await studioRequest.json()).status, "pending");

  const [savedPrimary] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, ownerA),
    eq(echoUniversesTable.universeId, "primary"),
  ));
  const saved = await writeUniverse(ownerA, {
    ...savedPrimary.state,
    characters: [{ id: "nela" }],
  }, savedPrimary.revision, "primary");
  assert.ok(saved);

  assert.equal(await activeFollows(and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowsTable.sourceUniverseId, "primary"),
    eq(echoCharacterFollowsTable.sourceCharacterId, "same-id"),
  )), 0);
  assert.equal(await activeFollows(and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowsTable.sourceUniverseId, "studio"),
    eq(echoCharacterFollowsTable.sourceCharacterId, "same-id"),
  )), 0);
  const remainingRequest = await db.select().from(echoCharacterFollowRequestsTable).where(and(
    eq(echoCharacterFollowRequestsTable.sourceOwnerId, ownerA),
    eq(echoCharacterFollowRequestsTable.sourceUniverseId, "studio"),
    eq(echoCharacterFollowRequestsTable.sourceCharacterId, "same-id"),
  ));
  assert.equal(remainingRequest.length, 1);
  const [privacyForRemoved] = await db.select().from(echoCharacterPrivacyTable).where(and(
    eq(echoCharacterPrivacyTable.ownerId, ownerA),
    eq(echoCharacterPrivacyTable.universeId, "primary"),
    eq(echoCharacterPrivacyTable.characterId, "same-id"),
  ));
  assert.equal(privacyForRemoved, undefined);
  const [afterSave] = await db.select({ state: echoUniversesTable.state }).from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, ownerA),
    eq(echoUniversesTable.universeId, "primary"),
  ));
  assert.deepEqual(afterSave.state.follows, legacy);
});
