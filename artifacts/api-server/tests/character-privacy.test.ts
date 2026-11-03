import assert from "node:assert/strict";
import { after, afterEach, before, test } from "node:test";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  echoCharacterPrivacyTable,
  echoCreatorEntitlementsTable,
  echoUniversesTable,
} from "@workspace/db";
import { createAdditionalUniverse, writeUniverse } from "../src/lib/universeRepository";
import { createCharacterPrivacyRouter } from "../src/routes/character-privacy";

const owners = [
  `character-privacy-test-${crypto.randomUUID()}`,
  `character-privacy-test-${crypto.randomUUID()}`,
  `character-privacy-test-${crypto.randomUUID()}`,
];
let server: Server;
let baseUrl = "";

async function cleanup(): Promise<void> {
  await db.delete(echoCharacterPrivacyTable).where(inArray(echoCharacterPrivacyTable.ownerId, owners));
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await db.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, owners));
}

async function seedUniverse(ownerId: string, universeId: string, ids: string[]): Promise<void> {
  await db.insert(echoUniversesTable).values({
    ownerId,
    universeId,
    revision: 1,
    state: { characters: ids.map((id) => ({ id })) },
  });
}

function headers(ownerId?: string): HeadersInit {
  return ownerId ? { "x-test-owner": ownerId } : {};
}

async function getVisibility(ownerId: string | undefined, characterId: string, universeId?: string) {
  const query = universeId ? `?universeId=${encodeURIComponent(universeId)}` : "";
  return fetch(`${baseUrl}/character-privacy/${encodeURIComponent(characterId)}/visibility${query}`, {
    headers: headers(ownerId),
  });
}

async function putVisibility(
  ownerId: string,
  characterId: string,
  visibility: unknown,
  universeId?: string,
  extra: Record<string, unknown> = {},
) {
  const query = universeId ? `?universeId=${encodeURIComponent(universeId)}` : "";
  return fetch(`${baseUrl}/character-privacy/${encodeURIComponent(characterId)}/visibility${query}`, {
    method: "PUT",
    headers: { ...headers(ownerId), "content-type": "application/json" },
    body: JSON.stringify({ visibility, ...extra }),
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
  app.use(createCharacterPrivacyRouter({ authenticate: syntheticAuth }));
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

test("legacy and newly saved characters persist public visibility by default", async () => {
  await seedUniverse(owners[0], "primary", ["nela", "legacy"]);

  const legacyResponse = await getVisibility(owners[0], "legacy");
  assert.equal(legacyResponse.status, 200);
  assert.deepEqual(await legacyResponse.json(), {
    universeId: "primary", characterId: "legacy", visibility: "public",
  });
  const [legacyRow] = await db.select().from(echoCharacterPrivacyTable).where(and(
    eq(echoCharacterPrivacyTable.ownerId, owners[0]),
    eq(echoCharacterPrivacyTable.universeId, "primary"),
    eq(echoCharacterPrivacyTable.characterId, "legacy"),
  ));
  assert.equal(legacyRow.visibility, "public");

  const created = await writeUniverse(owners[2], {
    creatorSetup: { plan: "creator" },
    characters: [{ id: "nela" }, { id: "new-character" }],
  }, 0, "primary");
  assert.ok(created);
  const [newRow] = await db.select().from(echoCharacterPrivacyTable).where(and(
    eq(echoCharacterPrivacyTable.ownerId, owners[2]),
    eq(echoCharacterPrivacyTable.universeId, "primary"),
    eq(echoCharacterPrivacyTable.characterId, "new-character"),
  ));
  assert.equal(newRow.visibility, "public");
  const newResponse = await getVisibility(owners[2], "new-character");
  assert.equal(newResponse.status, 200);
  assert.equal((await newResponse.json()).visibility, "public");

  const additional = await createAdditionalUniverse(owners[2], "Second universe", {
    characters: [{ id: "secondary-character" }],
  });
  const [secondaryRow] = await db.select().from(echoCharacterPrivacyTable).where(and(
    eq(echoCharacterPrivacyTable.ownerId, owners[2]),
    eq(echoCharacterPrivacyTable.universeId, additional.universeId),
    eq(echoCharacterPrivacyTable.characterId, "secondary-character"),
  ));
  assert.equal(secondaryRow.visibility, "public");
  assert.equal(
    (await (await getVisibility(owners[2], "secondary-character", additional.universeId)).json()).visibility,
    "public",
  );
});

test("only the owner can change a character in the requested universe and the setting persists", async () => {
  await seedUniverse(owners[0], "primary", ["nela", "same-id"]);
  await seedUniverse(owners[0], "studio", ["nela", "same-id"]);
  await seedUniverse(owners[1], "studio", ["nela", "same-id"]);

  const changed = await putVisibility(owners[0], "same-id", "private", "studio");
  assert.equal(changed.status, 200);
  assert.deepEqual(await changed.json(), {
    universeId: "studio", characterId: "same-id", visibility: "private",
  });
  assert.equal((await (await getVisibility(owners[0], "same-id", "studio")).json()).visibility, "private");
  assert.equal((await (await getVisibility(owners[0], "same-id", "primary")).json()).visibility, "public");
  assert.equal((await (await getVisibility(owners[1], "same-id", "studio")).json()).visibility, "public");
});

test("missing/foreign characters and invalid visibility input fail safely", async () => {
  await seedUniverse(owners[0], "primary", ["nela", "owned"]);
  await seedUniverse(owners[0], "studio", ["nela", "studio-only"]);

  assert.equal((await getVisibility(undefined, "owned")).status, 401);
  assert.equal((await getVisibility(owners[1], "owned", "primary")).status, 404);
  assert.equal((await getVisibility(owners[0], "owned", "missing-universe")).status, 404);
  assert.equal((await getVisibility(owners[0], "owned", "studio")).status, 404);
  assert.equal((await getVisibility(owners[0], "missing-character", "primary")).status, 404);
  assert.equal((await putVisibility(owners[0], "owned", "private", "studio")).status, 404);
  assert.equal((await putVisibility(owners[0], "owned", "friends")).status, 400);
  assert.equal((await putVisibility(owners[0], "owned", "private", "primary", { ownerId: owners[1] })).status, 400);
  const repeatedUniverse = await fetch(
    `${baseUrl}/character-privacy/owned/visibility?universeId=primary&universeId=studio`,
    { headers: headers(owners[0]) },
  );
  assert.equal(repeatedUniverse.status, 400);
});
