import assert from "node:assert/strict";
import { after, afterEach, before, beforeEach, test } from "node:test";
import { createServer, type Server } from "node:http";
import { once } from "node:events";
import express, { type RequestHandler } from "express";
import { inArray, or } from "drizzle-orm";
import {
  db,
  echoCharacterFollowRequestsTable,
  echoCharacterFollowsTable,
  echoCharacterPrivacyTable,
  echoCreatorEntitlementsTable,
  echoUniversesTable,
} from "@workspace/db";
import { createSocialReadRouter } from "../src/routes/social-reads";
import type { CharacterIdentity } from "../src/lib/characterFollows";

const owners = [
  `social-read-test-${crypto.randomUUID()}`,
  `social-read-test-${crypto.randomUUID()}`,
  `social-read-test-${crypto.randomUUID()}`,
];
const [targetOwner, viewerOwner, otherOwner] = owners;
const characterId = "repeated-character-id";
const postId = "repeated-post-id";
const NOW = Date.parse("2026-11-03T12:00:00.000Z");

let server: Server;
let baseUrl = "";

function targetPath(ownerId: string, universeId: string, charId = characterId, suffix = ""): string {
  return `/social/owners/${encodeURIComponent(ownerId)}/universes/${encodeURIComponent(universeId)}` +
    `/characters/${encodeURIComponent(charId)}${suffix}`;
}

function viewerQuery(character = "accepted-viewer", universe = "primary"): string {
  const query = new URLSearchParams({
    viewerUniverseId: universe,
    viewerCharacterId: character,
  });
  return `?${query.toString()}`;
}

async function get(ownerId: string | null, path: string): Promise<Response> {
  const headers: Record<string, string> = ownerId ? { "x-test-owner": ownerId } : {};
  return fetch(new URL(path, baseUrl), { headers });
}

function seedState(
  character: Record<string, unknown>,
  posts: Record<string, unknown>[],
  stories: Record<string, unknown>[] = [],
  extra: Record<string, unknown> = {},
): Record<string, unknown> {
  return {
    version: 1,
    currentCharacterId: String(character.id),
    characters: [character],
    follows: {},
    posts,
    comments: [{ id: "private-comment", text: "COMMENT_SECRET", authorId: character.id }],
    stories,
    messages: [{ id: "private-message", content: "MESSAGE_SECRET" }],
    notifications: [],
    ...extra,
  };
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
  state: Record<string, unknown>,
): Promise<void> {
  await db.insert(echoUniversesTable).values({ ownerId, universeId, revision: 1, state });
}

async function seedFixture(): Promise<void> {
  await cleanup();
  const privateCharacter = {
    id: characterId,
    handle: "private-character",
    name: "Private Character",
    occupation: "Musician",
    bio: "PUBLIC_BIO",
    location: "Public City",
    avatar: "/objects/private-avatar",
    verified: true,
    accountType: "personal",
    archived: false,
    displayMetrics: { followers: 123456, following: 54321 },
    providerRef: { provider: "PRIVATE_PROVIDER", characterId: "PROVIDER_SECRET" },
    identity: { kind: "internal", ref: "IDENTITY_SECRET" },
    configuration: { personality: { description: "CONFIGURATION_SECRET" } },
  };
  await seedUniverse(targetOwner, "primary", seedState(privateCharacter, [
    {
      id: postId, authorId: characterId, caption: "PRIVATE_POST_NEWEST",
      location: "Public Location", image: "/objects/private-post",
      media: [{ id: "item-1", type: "image", url: "/objects/private-carousel", width: 600, height: 900 }],
      createdAt: new Date(NOW).toISOString(), likes: ["private-like"],
      savedBy: ["private-save"], displayMetrics: { likes: 999999 }, comments: [{ id: "hidden-comment" }],
      taggedAccountIds: ["PRIVATE_TAG_SECRET"], origin: "internal-origin", illustrative: true,
      commentsEnabled: true, pinned: true,
    },
    {
      id: "private-text-post", authorId: characterId, caption: "PRIVATE_POST_OLDER",
      location: "", image: "", createdAt: new Date(NOW - 60_000).toISOString(),
      likes: [], savedBy: [], displayMetrics: { likes: 0 },
    },
  ], [
    {
      id: "active-story", authorId: characterId, image: "/objects/active-story",
      caption: "ACTIVE_STORY", createdAt: new Date(NOW - 60_000).toISOString(),
      seenBy: ["VIEWER_SECRET"], reactions: [{ authorId: "REACTION_SECRET", emoji: "❤️" }],
      mentionedAccountIds: ["MENTION_SECRET"],
      music: { title: "Song", artist: "Artist", providerRef: "MUSIC_PROVIDER_SECRET" },
    },
    {
      id: "expired-story", authorId: characterId, image: "/objects/expired-story",
      caption: "EXPIRED_STORY", createdAt: new Date(NOW - 25 * 60 * 60 * 1000).toISOString(),
    },
    {
      id: "highlighted-story", authorId: characterId, image: "/objects/highlight-story",
      caption: "HIGHLIGHT_STORY", createdAt: new Date(NOW - 26 * 60 * 60 * 1000).toISOString(),
    },
  ], {
    highlights: [{ id: "highlight-secret", authorId: characterId, title: "Saved", storyIds: ["highlighted-story"] }],
    ownerPrivateField: "OWNER_ONLY_SECRET",
  }));

  await seedUniverse(targetOwner, "studio", seedState({
    id: characterId, handle: "public-character", name: "Public Character",
    occupation: "Artist", bio: "PUBLIC_STUDIO_BIO", location: "Public Studio",
    avatar: "/objects/public-avatar", verified: false, accountType: "official",
    displayMetrics: { followers: 8_888_888 },
    configuration: { personality: { description: "PUBLIC_CONFIG_MUST_STAY_PRIVATE" } },
  }, [
    {
      id: postId, authorId: characterId, caption: "PUBLIC_STUDIO_POST",
      location: "Studio", image: "/objects/public-post",
      createdAt: new Date(NOW + 60_000).toISOString(), likes: ["secret"],
    },
    {
      id: "public-studio-older", authorId: characterId, caption: "PUBLIC_STUDIO_OLDER",
      location: "", image: "/objects/public-carousel",
      createdAt: new Date(NOW - 120_000).toISOString(),
    },
  ], [{
    id: "public-story", authorId: characterId, image: "/objects/public-story",
    caption: "PUBLIC_STUDIO_STORY", createdAt: new Date(NOW - 60_000).toISOString(),
  }]));

  await seedUniverse(otherOwner, "primary", seedState({
    id: characterId, handle: "other-owner-character", name: "Other Owner",
    occupation: "", bio: "OTHER_OWNER_BIO", location: "", avatar: "/objects/other-avatar",
    verified: false, accountType: "personal",
  }, [{
    id: postId, authorId: characterId, caption: "OTHER_OWNER_PUBLIC_POST",
    location: "", image: "/objects/other-post", createdAt: new Date(NOW - 180_000).toISOString(),
  }]));

  await seedUniverse(viewerOwner, "primary", {
    version: 1,
    currentCharacterId: "accepted-viewer",
    characters: [
      { id: "accepted-viewer", handle: "viewer", name: "Viewer", occupation: "", bio: "", location: "", avatar: "", verified: false, accountType: "personal" },
      { id: "pending-viewer" },
      { id: "rejected-viewer" },
      { id: "cancelled-viewer" },
    ],
    follows: { "pending-viewer": [characterId] },
    posts: [{
      id: "viewer-own-post", authorId: "accepted-viewer", caption: "VIEWER_OWN_POST",
      location: "", image: "", createdAt: new Date(NOW - 90_000).toISOString(),
    }],
    comments: [], stories: [], messages: [], notifications: [],
  });
  await seedUniverse(viewerOwner, "studio", seedState({
    id: "accepted-viewer", handle: "viewer-studio", name: "Viewer Studio",
    occupation: "", bio: "", location: "", avatar: "", verified: false, accountType: "personal",
  }, []));

  await db.insert(echoCharacterPrivacyTable).values({
    ownerId: targetOwner, universeId: "primary", characterId, visibility: "private",
  });
  await db.insert(echoCharacterFollowsTable).values({
    sourceOwnerId: viewerOwner,
    sourceUniverseId: "primary",
    sourceCharacterId: "accepted-viewer",
    targetOwnerId: targetOwner,
    targetUniverseId: "primary",
    targetCharacterId: characterId,
  });
  await db.insert(echoCharacterFollowRequestsTable).values([
    {
      sourceOwnerId: viewerOwner, sourceUniverseId: "primary", sourceCharacterId: "pending-viewer",
      targetOwnerId: targetOwner, targetUniverseId: "primary", targetCharacterId: characterId, status: "pending",
    },
    {
      sourceOwnerId: viewerOwner, sourceUniverseId: "primary", sourceCharacterId: "rejected-viewer",
      targetOwnerId: targetOwner, targetUniverseId: "primary", targetCharacterId: characterId, status: "rejected",
    },
    {
      sourceOwnerId: viewerOwner, sourceUniverseId: "primary", sourceCharacterId: "cancelled-viewer",
      targetOwnerId: targetOwner, targetUniverseId: "primary", targetCharacterId: characterId, status: "cancelled",
    },
  ]);
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
  app.use(createSocialReadRouter({ authenticate: syntheticAuth }));
  server = createServer(app);
  server.listen(0, "127.0.0.1");
  await once(server, "listening");
  const address = server.address();
  if (!address || typeof address === "string") throw new Error("TEST_SERVER_ADDRESS_UNAVAILABLE");
  baseUrl = `http://127.0.0.1:${address.port}`;
});

beforeEach(seedFixture);
afterEach(cleanup);
after(async () => {
  server?.closeAllConnections();
  if (server?.listening) await new Promise<void>((resolve) => server.close(() => resolve()));
  await cleanup();
});

test("profile read enforces public/private visibility and returns only an explicit safe projection", async () => {
  const own = await get(targetOwner, targetPath(targetOwner, "primary"));
  assert.equal(own.status, 200);
  const ownBody = await own.json() as { identity: Record<string, unknown>; profile: Record<string, unknown> };
  assert.equal(ownBody.identity.ownerId, targetOwner);
  assert.equal(ownBody.profile.bio, "PUBLIC_BIO");
  for (const hidden of ["configuration", "providerRef", "identity", "displayMetrics", "ownerPrivateField"]) {
    assert.equal(hidden in ownBody.profile, false);
  }

  const publicProfile = await get(viewerOwner, targetPath(targetOwner, "studio"));
  assert.equal(publicProfile.status, 200);
  assert.equal((await publicProfile.json()).profile.bio, "PUBLIC_STUDIO_BIO");
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery())).status, 200);
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery("pending-viewer"))).status, 404);
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery("rejected-viewer"))).status, 404);
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery("cancelled-viewer"))).status, 404);
  assert.equal((await get(otherOwner, targetPath(targetOwner, "primary"))).status, 404);
});

test("profile routes reject anonymous, malformed, foreign and client-asserted owner identities", async () => {
  const route = targetPath(targetOwner, "primary");
  assert.equal((await get(null, route)).status, 401);
  assert.equal((await get(viewerOwner, `${route}?viewerUniverseId=primary`)).status, 400);
  assert.equal((await get(viewerOwner, `${route}?ownerId=${targetOwner}`)).status, 400);
  assert.equal((await get(viewerOwner, `${route}?viewerUniverseId=primary&viewerCharacterId=${characterId}`)).status, 404);
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "nonexistent"))).status, 404);
  assert.equal((await get(otherOwner, targetPath(targetOwner, "primary"))).status, 404);
});

test("character post lists and direct URLs enforce visibility and omit private social metadata", async () => {
  const privateRoute = targetPath(targetOwner, "primary", characterId, "/posts");
  const accepted = await get(viewerOwner, privateRoute + viewerQuery());
  assert.equal(accepted.status, 200);
  const body = await accepted.json() as { posts: Record<string, unknown>[]; nextCursor: unknown };
  assert.equal(body.posts.length, 2);
  assert.equal(body.posts[0]?.caption, "PRIVATE_POST_NEWEST");
  for (const hidden of ["likes", "savedBy", "displayMetrics", "comments", "taggedAccountIds", "origin", "illustrative"]) {
    assert.equal(hidden in body.posts[0]!, false);
  }
  assert.equal(typeof body.posts[0]?.media, "object");
  assert.equal((await get(viewerOwner, privateRoute + viewerQuery("pending-viewer"))).status, 404);
  assert.equal((await get(otherOwner, privateRoute)).status, 404);

  const directRoute = targetPath(targetOwner, "primary", characterId, `/posts/${postId}`);
  const directAccepted = await get(viewerOwner, directRoute + viewerQuery());
  assert.equal(directAccepted.status, 200);
  assert.equal((await get(viewerOwner, directRoute + viewerQuery("pending-viewer"))).status, 404);
  assert.equal((await get(otherOwner, directRoute)).status, 404);

  const repeatedStudioId = await get(viewerOwner, targetPath(targetOwner, "studio", characterId, `/posts/${postId}`));
  assert.equal(repeatedStudioId.status, 200);
  assert.equal((await repeatedStudioId.json()).post.caption, "PUBLIC_STUDIO_POST");
  const repeatedOtherOwnerId = await get(viewerOwner, targetPath(otherOwner, "primary", characterId, `/posts/${postId}`));
  assert.equal(repeatedOtherOwnerId.status, 200);
  assert.equal((await repeatedOtherOwnerId.json()).post.caption, "OTHER_OWNER_PUBLIC_POST");
});

test("post pagination and media filters are scoped to the authorized character", async () => {
  const route = targetPath(targetOwner, "primary", characterId, "/posts");
  const viewer = new URLSearchParams(viewerQuery().slice(1));
  const first = await get(viewerOwner, `${route}?limit=1&${viewer}`);
  assert.equal(first.status, 200);
  const firstBody = await first.json() as { posts: Array<{ id: string }>; nextCursor: string | null };
  assert.equal(firstBody.posts.length, 1);
  assert.ok(firstBody.nextCursor);
  const second = await get(viewerOwner, `${route}?limit=1&cursor=${encodeURIComponent(firstBody.nextCursor!)}&${viewer}`);
  const secondBody = await second.json() as { posts: Array<{ id: string; caption: string }>; nextCursor: string | null };
  assert.equal(secondBody.posts.length, 1);
  assert.notEqual(secondBody.posts[0]?.id, firstBody.posts[0]?.id);
  assert.equal(secondBody.posts[0]?.caption, "PRIVATE_POST_OLDER");

  const mediaOnly = await get(viewerOwner, `${route}?mediaOnly=true&${viewer}`);
  const mediaBody = await mediaOnly.json() as { posts: Array<{ id: string }> };
  assert.deepEqual(mediaBody.posts.map((post) => post.id), [postId]);
  assert.equal((await get(viewerOwner, `${route}?limit=100&${viewer}`)).status, 400);
  assert.equal((await get(viewerOwner, `${route}?cursor=invalid&${viewer}`)).status, 400);
});

test("Stories expose only active or highlighted items and omit viewers/reactions/internal references", async () => {
  const route = targetPath(targetOwner, "primary", characterId, "/stories");
  const response = await get(viewerOwner, route + viewerQuery());
  assert.equal(response.status, 200);
  const body = await response.json() as { stories: Record<string, unknown>[] };
  assert.deepEqual(body.stories.map((story) => story.id).sort(), ["active-story", "highlighted-story"]);
  assert.equal(body.stories.find((story) => story.id === "highlighted-story")?.highlighted, true);
  for (const hidden of ["seenBy", "reactions", "mentionedAccountIds"]) {
    assert.equal(hidden in body.stories[0]!, false);
  }
  assert.equal(
    ((body.stories.find((story) => story.id === "active-story")?.music as Record<string, unknown>)?.providerRef),
    undefined,
  );
  const directActive = await get(
    viewerOwner,
    targetPath(targetOwner, "primary", characterId, "/stories/active-story") + viewerQuery(),
  );
  assert.equal(directActive.status, 200);
  assert.equal((await directActive.json()).story.id, "active-story");
  assert.equal(
    (await get(
      viewerOwner,
      targetPath(targetOwner, "primary", characterId, "/stories/expired-story") + viewerQuery(),
    )).status,
    404,
  );
  assert.equal(
    (await get(
      viewerOwner,
      targetPath(targetOwner, "primary", characterId, "/stories/active-story") +
        viewerQuery("pending-viewer"),
    )).status,
    404,
  );
  assert.equal((await get(viewerOwner, route + viewerQuery("pending-viewer"))).status, 404);
  assert.equal((await get(otherOwner, targetPath(targetOwner, "primary", characterId, "/stories"))).status, 404);
});

test("aggregate feed includes visible public, own-active-universe and accepted private posts only", async () => {
  const feed = (character: string, universe = "primary") =>
    `/social/feed?viewerUniverseId=${universe}&viewerCharacterId=${character}`;
  const acceptedResponse = await get(viewerOwner, feed("accepted-viewer"));
  assert.equal(acceptedResponse.status, 200);
  const acceptedBody = await acceptedResponse.json() as {
    items: Array<{ identity: CharacterIdentity; post: Record<string, unknown> }>;
    totalCount?: unknown;
  };
  const captions = acceptedBody.items.map((item) => item.post.caption);
  assert.ok(captions.includes("PRIVATE_POST_NEWEST"));
  assert.ok(captions.includes("PUBLIC_STUDIO_POST"));
  assert.ok(captions.includes("OTHER_OWNER_PUBLIC_POST"));
  assert.ok(captions.includes("VIEWER_OWN_POST"));
  assert.equal("totalCount" in acceptedBody, false);
  assert.equal(acceptedBody.items.some((item) => "comments" in item.post || "displayMetrics" in item.post), false);

  const pendingBody = await (await get(viewerOwner, feed("pending-viewer"))).json() as {
    items: Array<{ identity: CharacterIdentity; post: Record<string, unknown> }>;
  };
  assert.equal(pendingBody.items.some((item) =>
    item.identity.ownerId === targetOwner &&
    item.identity.universeId === "primary" &&
    item.post.caption === "PRIVATE_POST_NEWEST",
  ), false);
  assert.ok(pendingBody.items.some((item) => item.post.caption === "PUBLIC_STUDIO_POST"));

  const activeStudioBody = await (await get(viewerOwner, feed("accepted-viewer", "studio"))).json() as {
    items: Array<{ identity: CharacterIdentity; post: Record<string, unknown> }>;
  };
  assert.equal(activeStudioBody.items.some((item) =>
    item.identity.ownerId === viewerOwner && item.identity.universeId === "primary",
  ), false, "owner's other universe must not be mixed into the selected universe feed");
});

test("feed pagination and mediaOnly filtering avoid duplicate or unauthorized pages", async () => {
  const route = "/social/feed?viewerUniverseId=primary&viewerCharacterId=accepted-viewer";
  const firstResponse = await get(viewerOwner, `${route}&limit=2`);
  assert.equal(firstResponse.status, 200);
  const first = await firstResponse.json() as { items: Array<{ identity: CharacterIdentity; post: { id: string } }>; nextCursor: string | null };
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await get(viewerOwner, `${route}&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
  const secondBody = await second.json() as { items: Array<{ identity: CharacterIdentity; post: { id: string } }> };
  const keys = [...first.items, ...secondBody.items].map((item) =>
    `${item.identity.ownerId}/${item.identity.universeId}/${item.identity.characterId}/${item.post.id}`,
  );
  assert.equal(new Set(keys).size, keys.length);

  const mediaOnly = await get(viewerOwner, `${route}&mediaOnly=true`);
  const mediaBody = await mediaOnly.json() as { items: Array<{ post: { caption: string } }> };
  assert.equal(mediaBody.items.some((item) => item.post.caption === "PRIVATE_POST_OLDER"), false);
  assert.equal((await get(viewerOwner, "/social/feed?viewerUniverseId=primary&viewerCharacterId=missing")).status, 404);
  assert.equal((await get(viewerOwner, "/social/feed?viewerUniverseId=primary&viewerCharacterId=accepted-viewer&ownerId=other")).status, 400);
  assert.equal((await get(null, route)).status, 401);
});
