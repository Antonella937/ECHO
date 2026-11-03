import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
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
  echoMediaTable,
  echoUniversesTable,
} from "@workspace/db";
import { createStorageRouter } from "../src/routes/storage";
import { readAcceptedCharacterFollows } from "../src/lib/socialContentAccess";
import { manageUniverse } from "../src/lib/universeManagement";

const owners = [
  `social-content-test-${crypto.randomUUID()}`,
  `social-content-test-${crypto.randomUUID()}`,
  `social-content-test-${crypto.randomUUID()}`,
];
const [contentOwner, followerOwner, strangerOwner] = owners;
const objectPaths = {
  privatePost: `/objects/uploads/${crypto.randomUUID()}`,
  privateCarouselItem: `/objects/uploads/${crypto.randomUUID()}`,
  privateStory: `/objects/uploads/${crypto.randomUUID()}`,
  expiredStory: `/objects/uploads/${crypto.randomUUID()}`,
  highlightedStory: `/objects/uploads/${crypto.randomUUID()}`,
  privateAvatar: `/objects/uploads/${crypto.randomUUID()}`,
  publicPost: `/objects/uploads/${crypto.randomUUID()}`,
  publicCarouselItem: `/objects/uploads/${crypto.randomUUID()}`,
  publicStory: `/objects/uploads/${crypto.randomUUID()}`,
  publicAvatar: `/objects/uploads/${crypto.randomUUID()}`,
  sharedAcrossUniverses: `/objects/uploads/${crypto.randomUUID()}`,
  unattached: `/objects/uploads/${crypto.randomUUID()}`,
};
const allPaths = Object.values(objectPaths);

type SourceAssociation = {
  universeId: string;
  characterId: string;
  sourceType: "post" | "story" | "avatar";
  contentId: string;
};

function sourceForPath(objectPath: string): SourceAssociation | undefined {
  if (objectPath === objectPaths.privatePost || objectPath === objectPaths.privateCarouselItem) {
    return { universeId: "primary", characterId: "same-id", sourceType: "post", contentId: "same-post" };
  }
  if (objectPath === objectPaths.privateStory) {
    return { universeId: "primary", characterId: "same-id", sourceType: "story", contentId: "active-story" };
  }
  if (objectPath === objectPaths.expiredStory) {
    return { universeId: "primary", characterId: "same-id", sourceType: "story", contentId: "expired-story" };
  }
  if (objectPath === objectPaths.highlightedStory) {
    return { universeId: "primary", characterId: "same-id", sourceType: "story", contentId: "highlighted-story" };
  }
  if (objectPath === objectPaths.privateAvatar) {
    return { universeId: "primary", characterId: "same-id", sourceType: "avatar", contentId: "same-id" };
  }
  if (objectPath === objectPaths.publicPost || objectPath === objectPaths.publicCarouselItem) {
    return { universeId: "studio", characterId: "same-id", sourceType: "post", contentId: "same-post" };
  }
  if (objectPath === objectPaths.publicStory) {
    return { universeId: "studio", characterId: "same-id", sourceType: "story", contentId: "public-story" };
  }
  if (objectPath === objectPaths.publicAvatar) {
    return { universeId: "studio", characterId: "same-id", sourceType: "avatar", contentId: "same-id" };
  }
  return undefined;
}

let server: Server;
let baseUrl = "";
let downloadCount = 0;

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
  await db.delete(echoMediaTable).where(inArray(echoMediaTable.ownerId, owners));
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, owners));
  await db.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, owners));
}

async function seedUniverse(
  ownerId: string,
  universeId: string,
  state: Record<string, unknown>,
  sharingEnabled = false,
): Promise<void> {
  await db.insert(echoUniversesTable).values({
    ownerId,
    universeId,
    revision: 1,
    sharingEnabled,
    state,
  });
}

async function seedFixture(): Promise<void> {
  await cleanup();
  await seedUniverse(contentOwner, "primary", {
    characters: [
      { id: "same-id", avatar: objectPaths.privateAvatar },
      { id: "unrelated" },
    ],
    follows: {},
    posts: [{
      id: "same-post",
      authorId: "same-id",
      image: objectPaths.privatePost,
      media: [
        { url: objectPaths.privateCarouselItem, position: 1 },
        { url: objectPaths.sharedAcrossUniverses, position: 2 },
      ],
    }],
    stories: [
      { id: "active-story", authorId: "same-id", image: objectPaths.privateStory, createdAt: new Date().toISOString() },
      { id: "expired-story", authorId: "same-id", image: objectPaths.expiredStory, createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
      { id: "highlighted-story", authorId: "same-id", image: objectPaths.highlightedStory, createdAt: new Date(Date.now() - 25 * 60 * 60 * 1000).toISOString() },
    ],
    highlights: [{ id: "highlight", authorId: "same-id", storyIds: ["highlighted-story"] }],
  }, true);
  await seedUniverse(contentOwner, "studio", {
    characters: [{ id: "same-id", avatar: objectPaths.publicAvatar }],
    follows: {},
    posts: [{
      id: "same-post",
      authorId: "same-id",
      image: objectPaths.publicPost,
      media: [
        { url: objectPaths.publicCarouselItem, position: 1 },
        { url: objectPaths.sharedAcrossUniverses, position: 2 },
      ],
    }],
    stories: [{
      id: "public-story",
      authorId: "same-id",
      image: objectPaths.publicStory,
      createdAt: new Date().toISOString(),
    }],
  }, true);
  await seedUniverse(followerOwner, "primary", {
    characters: [
      { id: "accepted-viewer" },
      { id: "pending-viewer" },
      { id: "rejected-viewer" },
      { id: "cancelled-viewer" },
      { id: "same-id" },
      { id: "legacy-source" },
      { id: "legacy-target" },
    ],
    // This legacy ID resolves only to followerOwner/primary/same-id, never
    // to contentOwner/primary/same-id despite the collision.
    follows: {
      "pending-viewer": ["same-id"],
      "legacy-source": ["legacy-target"],
    },
    posts: [],
    stories: [],
  });
  await seedUniverse(followerOwner, "studio", {
    characters: [{ id: "accepted-viewer" }],
    follows: {},
    posts: [],
    stories: [],
  });
  await seedUniverse(strangerOwner, "primary", {
    characters: [{ id: "stranger" }],
    follows: {},
    posts: [],
    stories: [],
  });

  await db.insert(echoCharacterPrivacyTable).values({
    ownerId: contentOwner,
    universeId: "primary",
    characterId: "same-id",
    visibility: "private",
  });
  // New relational accepted follow; the legacy local edge below is duplicated
  // in both sources to verify full-identity deduplication.
  await db.insert(echoCharacterFollowsTable).values([
    {
      sourceOwnerId: followerOwner, sourceUniverseId: "primary", sourceCharacterId: "accepted-viewer",
      targetOwnerId: contentOwner, targetUniverseId: "primary", targetCharacterId: "same-id",
    },
    {
      sourceOwnerId: followerOwner, sourceUniverseId: "primary", sourceCharacterId: "legacy-source",
      targetOwnerId: followerOwner, targetUniverseId: "primary", targetCharacterId: "legacy-target",
    },
  ]);
  await db.insert(echoCharacterFollowRequestsTable).values([
    {
      sourceOwnerId: followerOwner, sourceUniverseId: "primary", sourceCharacterId: "pending-viewer",
      targetOwnerId: contentOwner, targetUniverseId: "primary", targetCharacterId: "same-id", status: "pending",
    },
    {
      sourceOwnerId: followerOwner, sourceUniverseId: "primary", sourceCharacterId: "rejected-viewer",
      targetOwnerId: contentOwner, targetUniverseId: "primary", targetCharacterId: "same-id", status: "rejected",
    },
    {
      sourceOwnerId: followerOwner, sourceUniverseId: "primary", sourceCharacterId: "cancelled-viewer",
      targetOwnerId: contentOwner, targetUniverseId: "primary", targetCharacterId: "same-id", status: "cancelled",
    },
    {
      sourceOwnerId: followerOwner, sourceUniverseId: "primary", sourceCharacterId: "accepted-viewer",
      targetOwnerId: contentOwner, targetUniverseId: "primary", targetCharacterId: "same-id", status: "accepted",
    },
  ]);
  await db.insert(echoMediaTable).values(allPaths.map((objectPath) => ({
    objectPath,
    ownerId: contentOwner,
  })));
}

function authHeaders(ownerId?: string): HeadersInit {
  return ownerId ? { "x-test-owner": ownerId } : {};
}

function objectUrl(
  objectPath: string,
  viewer?: { universeId: string; characterId: string },
  source: SourceAssociation | null = sourceForPath(objectPath) ?? null,
): string {
  const objectKey = objectPath.replace(/^\/objects\//, "");
  const url = new URL(`/storage/objects/${objectKey}`, baseUrl);
  if (viewer) {
    url.searchParams.set("viewerUniverseId", viewer.universeId);
    url.searchParams.set("viewerCharacterId", viewer.characterId);
  }
  if (source) {
    url.searchParams.set("sourceUniverseId", source.universeId);
    url.searchParams.set("sourceCharacterId", source.characterId);
    url.searchParams.set("sourceType", source.sourceType);
    url.searchParams.set("sourceContentId", source.contentId);
  }
  return url.toString();
}

async function getMedia(
  ownerId: string | undefined,
  objectPath: string,
  viewer?: { universeId: string; characterId: string },
  source?: SourceAssociation | null,
): Promise<Response> {
  return fetch(
    source === undefined ? objectUrl(objectPath, viewer) : objectUrl(objectPath, viewer, source),
    { headers: authHeaders(ownerId) },
  );
}

const syntheticAuth: RequestHandler = (req, res, next) => {
  const ownerId = req.header("x-test-owner");
  if (!ownerId) {
    res.status(401).json({ error: "Authentication required" });
    return;
  }
  req.userId = ownerId;
  next();
};

before(async () => {
  const app = express();
  app.use(express.json());
  const fakeStorage = {
    getObjectEntityUploadURL: async () => "https://upload.invalid",
    normalizeObjectEntityPath: (url: string) => url,
    trySetObjectEntityAclPolicy: async (path: string) => path,
    getObjectEntityFile: async () => ({}) as never,
    canAccessObjectEntity: async () => true,
    downloadObject: async () => {
      downloadCount++;
      return { status: 200, headers: new Headers({ "Content-Type": "image/jpeg" }), body: null };
    },
  } as unknown as NonNullable<Parameters<typeof createStorageRouter>[0]>["storage"];
  app.use(createStorageRouter({ authenticate: syntheticAuth, storage: fakeStorage }));
  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(async () => {
  downloadCount = 0;
  await seedFixture();
});

afterEach(cleanup);

after(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
});

test("archive revokes owner, follower and raw media URLs before bytes; restore preserves all content", async () => {
  const scope = and(eq(echoUniversesTable.ownerId, contentOwner), eq(echoUniversesTable.universeId, "primary"));
  const [before] = await db.select().from(echoUniversesTable).where(scope);
  await manageUniverse(contentOwner, "primary", { action: "archive", expectedRevision: 1 });
  const count = downloadCount;
  const paths = [objectPaths.privatePost, objectPaths.privateCarouselItem, objectPaths.privateStory,
    objectPaths.expiredStory, objectPaths.highlightedStory, objectPaths.privateAvatar];
  for (const path of paths) {
    for (const identity of [contentOwner, followerOwner, strangerOwner]) {
      const response = await getMedia(identity, path, identity === followerOwner
        ? { universeId: "primary", characterId: "accepted-viewer" } : undefined);
      assert.equal(response.status, 404);
      assert.deepEqual(await response.json(), { error: "Image not found" });
      assert.equal(response.headers.get("cache-control"), "private, no-store");
    }
    assert.equal((await getMedia(contentOwner, path, undefined, null)).status, 404);
  }
  const conditional = await fetch(objectUrl(objectPaths.privatePost), {
    headers: { "x-test-owner": contentOwner, range: "bytes=0-1", "if-none-match": '"old-cache"' },
  });
  assert.equal(conditional.status, 404);
  assert.equal(downloadCount, count);
  assert.equal((await getMedia(contentOwner, objectPaths.publicPost)).status, 200);
  assert.equal((await getMedia(contentOwner, objectPaths.unattached)).status, 200);
  await manageUniverse(contentOwner, "primary", { action: "restore", expectedRevision: 2 });
  for (const path of paths) assert.equal((await getMedia(contentOwner, path)).status, 200);
  assert.equal((await getMedia(followerOwner, objectPaths.privatePost,
    { universeId: "primary", characterId: "accepted-viewer" })).status, 200);
  const [after] = await db.select().from(echoUniversesTable).where(scope);
  assert.deepEqual(after.state, before.state);
  assert.equal(after.sharingEnabled, before.sharingEnabled);
});

test("shared object cannot bypass archived source via owner shortcut or omitted identity", async () => {
  await manageUniverse(contentOwner, "primary", { action: "archive", expectedRevision: 1 });
  for (const identity of [contentOwner, strangerOwner]) {
    assert.equal((await getMedia(identity, objectPaths.sharedAcrossUniverses, undefined,
      { universeId: "primary", characterId: "same-id", sourceType: "post", contentId: "same-post" })).status, 404);
    assert.equal((await getMedia(identity, objectPaths.sharedAcrossUniverses, undefined,
      { universeId: "studio", characterId: "same-id", sourceType: "post", contentId: "same-post" })).status, 200);
  }
  assert.equal((await getMedia(contentOwner, objectPaths.sharedAcrossUniverses, undefined, null)).status, 404);
  await manageUniverse(contentOwner, "primary", { action: "restore", expectedRevision: 2 });
  assert.equal((await getMedia(contentOwner, objectPaths.sharedAcrossUniverses, undefined, null)).status, 200);
});

test("archived viewer cannot use public media or accepted edges; restored viewer can", async () => {
  await manageUniverse(followerOwner, "primary", { action: "archive", expectedRevision: 1 });
  const viewer = { universeId: "primary", characterId: "accepted-viewer" };
  assert.equal((await getMedia(followerOwner, objectPaths.publicPost, viewer)).status, 404);
  assert.equal((await getMedia(followerOwner, objectPaths.privatePost, viewer)).status, 404);
  assert.deepEqual(await readAcceptedCharacterFollows(followerOwner, "primary"), []);
  await manageUniverse(followerOwner, "primary", { action: "restore", expectedRevision: 2 });
  assert.equal((await getMedia(followerOwner, objectPaths.privatePost, viewer)).status, 200);
  await manageUniverse(contentOwner, "primary", { action: "archive", expectedRevision: 1 });
  const edges = await readAcceptedCharacterFollows(followerOwner, "primary");
  assert.ok(edges.every(edge => edge.target.ownerId !== contentOwner));
});

test("raw owner URL cannot expose a nested message attachment from an archived universe", async () => {
  const scope = and(eq(echoUniversesTable.ownerId, contentOwner), eq(echoUniversesTable.universeId, "primary"));
  const [before] = await db.select().from(echoUniversesTable).where(scope);
  await db.update(echoUniversesTable).set({
    state: { ...before.state, messages: [{ attachment: { url: objectPaths.unattached } }] },
  }).where(scope);
  await manageUniverse(contentOwner, "primary", { action: "archive", expectedRevision: 1 });
  assert.equal((await getMedia(contentOwner, objectPaths.unattached)).status, 404);
  await manageUniverse(contentOwner, "primary", { action: "restore", expectedRevision: 2 });
  assert.equal((await getMedia(contentOwner, objectPaths.unattached)).status, 200);
});

test("private media is readable by its owner and public media by any authenticated owner", async () => {
  for (const path of [
    objectPaths.privatePost,
    objectPaths.privateCarouselItem,
    objectPaths.privateStory,
    objectPaths.privateAvatar,
  ]) {
    assert.equal((await getMedia(contentOwner, path)).status, 200);
  }
  for (const path of [
    objectPaths.publicPost,
    objectPaths.publicCarouselItem,
    objectPaths.publicStory,
    objectPaths.publicAvatar,
  ]) {
    assert.equal((await getMedia(strangerOwner, path)).status, 200);
  }
  assert.equal(downloadCount, 8);
});

test("private media allows only the exact accepted follower; pending, rejected, cancelled and other universes are denied", async () => {
  const privatePaths = [
    objectPaths.privatePost,
    objectPaths.privateCarouselItem,
    objectPaths.privateStory,
    objectPaths.privateAvatar,
  ];
  for (const path of privatePaths) {
    assert.equal((await getMedia(followerOwner, path, {
      universeId: "primary", characterId: "accepted-viewer",
    })).status, 200);
    for (const characterId of ["pending-viewer", "rejected-viewer", "cancelled-viewer"]) {
      assert.equal((await getMedia(followerOwner, path, {
        universeId: "primary", characterId,
      })).status, 404);
    }
    assert.equal((await getMedia(followerOwner, path, {
      universeId: "studio", characterId: "accepted-viewer",
    })).status, 404);
    assert.equal((await getMedia(strangerOwner, path)).status, 404);
    assert.equal((await getMedia(followerOwner, path)).status, 404);
  }
  const denied = await getMedia(strangerOwner, objectPaths.privatePost);
  const pending = await getMedia(followerOwner, objectPaths.privatePost, {
    universeId: "primary", characterId: "pending-viewer",
  });
  assert.equal(await pending.text(), JSON.stringify({ error: "Image not found" }));
  assert.equal(await denied.text(), JSON.stringify({ error: "Image not found" }));
  assert.equal(downloadCount, privatePaths.length, "denials must happen before object bytes are opened");
});

test("post, Story and avatar media keep owner/universe identity; repeated IDs cannot cross visibility", async () => {
  const acceptedViewer = { universeId: "primary", characterId: "accepted-viewer" };
  assert.equal((await getMedia(followerOwner, objectPaths.privateStory, acceptedViewer)).status, 200);
  assert.equal((await getMedia(followerOwner, objectPaths.privateAvatar, acceptedViewer)).status, 200);

  // Same author and post IDs exist in primary/private and studio/public.
  assert.equal((await getMedia(strangerOwner, objectPaths.privatePost)).status, 404);
  assert.equal((await getMedia(strangerOwner, objectPaths.publicPost)).status, 200);
  assert.equal((await getMedia(strangerOwner, objectPaths.privateCarouselItem)).status, 404);
  assert.equal((await getMedia(strangerOwner, objectPaths.publicCarouselItem)).status, 200);
  assert.equal((await getMedia(strangerOwner, objectPaths.publicStory)).status, 200);
  assert.equal((await getMedia(strangerOwner, objectPaths.publicAvatar)).status, 200);
  assert.equal((await getMedia(followerOwner, objectPaths.publicPost)).status, 200);
});

test("expired Story media is hidden unless retained in a highlight", async () => {
  const viewer = { universeId: "primary", characterId: "accepted-viewer" };
  assert.equal((await getMedia(followerOwner, objectPaths.expiredStory, viewer)).status, 404);
  assert.equal((await getMedia(followerOwner, objectPaths.highlightedStory, viewer)).status, 200);
  assert.equal((await getMedia(strangerOwner, objectPaths.expiredStory)).status, 404);
});

test("sharing OFF denies public and accepted-follow media before opening bytes", async () => {
  await db.update(echoUniversesTable).set({ sharingEnabled: false })
    .where(eq(echoUniversesTable.ownerId, contentOwner));
  const accepted = { universeId: "primary", characterId: "accepted-viewer" };
  for (const path of [
    objectPaths.publicPost, objectPaths.publicAvatar, objectPaths.publicStory,
    objectPaths.privatePost, objectPaths.privateAvatar, objectPaths.privateStory,
    objectPaths.highlightedStory,
  ]) {
    const response = await getMedia(followerOwner, path, accepted);
    assert.equal(response.status, 404);
    assert.deepEqual(await response.json(), { error: "Image not found" });
    assert.equal(response.headers.get("cache-control"), "private, no-store");
  }
  assert.equal(downloadCount, 0);
  assert.equal((await getMedia(contentOwner, objectPaths.privatePost)).status, 200);
});

test("one object reused across universes requires its exact source association", async () => {
  await db.update(echoUniversesTable).set({ sharingEnabled: false }).where(and(
    eq(echoUniversesTable.ownerId, contentOwner),
    eq(echoUniversesTable.universeId, "primary"),
  ));
  const accepted = { universeId: "primary", characterId: "accepted-viewer" };
  const primary: SourceAssociation = {
    universeId: "primary", characterId: "same-id", sourceType: "post", contentId: "same-post",
  };
  const studio: SourceAssociation = { ...primary, universeId: "studio" };
  const denied = await getMedia(followerOwner, objectPaths.sharedAcrossUniverses, accepted, primary);
  assert.equal(denied.status, 404);
  assert.equal((await getMedia(strangerOwner, objectPaths.sharedAcrossUniverses, undefined, null)).status, 404);
  for (const source of [
    { ...studio, contentId: "missing" },
    { ...studio, characterId: "unrelated" },
    { ...studio, sourceType: "avatar" as const, contentId: "same-id" },
    { ...studio, universeId: "missing" },
  ]) {
    assert.equal((await getMedia(strangerOwner, objectPaths.sharedAcrossUniverses, undefined, source)).status, 404);
  }
  assert.equal(downloadCount, 0);
  assert.equal((await getMedia(strangerOwner, objectPaths.sharedAcrossUniverses, undefined, studio)).status, 200);
  assert.equal(downloadCount, 1);
});

test("legacy and relational follows deduplicate by full identity and legacy IDs never infer cross-owner edges", async () => {
  const before = await db.select().from(echoCharacterFollowsTable).where(eq(
    echoCharacterFollowsTable.sourceOwnerId,
    followerOwner,
  ));
  const edges = await readAcceptedCharacterFollows(followerOwner, "primary");
  const duplicateLocal = edges.filter((candidate) =>
    candidate.source.ownerId === followerOwner &&
    candidate.source.universeId === "primary" &&
    candidate.source.characterId === "legacy-source" &&
    candidate.target.ownerId === followerOwner &&
    candidate.target.universeId === "primary" &&
    candidate.target.characterId === "legacy-target",
  );
  const inferredForeign = edges.filter((candidate) =>
    candidate.source.characterId === "pending-viewer" &&
    candidate.target.ownerId === contentOwner &&
    candidate.target.universeId === "primary" &&
    candidate.target.characterId === "same-id",
  );
  assert.equal(duplicateLocal.length, 1);
  assert.equal(inferredForeign.length, 0);
  const after = await db.select().from(echoCharacterFollowsTable).where(eq(
    echoCharacterFollowsTable.sourceOwnerId,
    followerOwner,
  ));
  assert.equal(after.length, before.length, "reading the merged graph must not rewrite existing relationships");
});

test("anonymous, nonexistent, malformed and unauthorized direct media requests do not disclose bytes or metadata", async () => {
  const anonymous = await getMedia(undefined, objectPaths.publicPost);
  assert.equal(anonymous.status, 401);

  const missing = await getMedia(strangerOwner, `/objects/uploads/${crypto.randomUUID()}`);
  assert.equal(missing.status, 404);
  const denied = await getMedia(strangerOwner, objectPaths.privatePost);
  assert.equal(denied.status, 404);
  assert.equal(await missing.text(), await denied.text());

  const malformed = await fetch(
    `${objectUrl(objectPaths.privatePost)}&viewerUniverseId=primary`,
    { headers: authHeaders(followerOwner) },
  );
  assert.equal(malformed.status, 400);
  assert.equal(downloadCount, 0);

  // An upload without a social reference remains private to its owner.
  assert.equal((await getMedia(contentOwner, objectPaths.unattached)).status, 200);
  assert.equal((await getMedia(strangerOwner, objectPaths.unattached)).status, 404);
});
