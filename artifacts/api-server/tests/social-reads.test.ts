import assert from "node:assert/strict";
import { manageUniverse } from "../src/lib/universeManagement";
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
  sharingEnabled = false,
): Promise<void> {
  await db.insert(echoUniversesTable).values({ ownerId, universeId, revision: 1, state, sharingEnabled });
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
  }), true);

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
  }]), true);

  await seedUniverse(otherOwner, "primary", seedState({
    id: characterId, handle: "other-owner-character", name: "Other Owner",
    occupation: "", bio: "OTHER_OWNER_BIO", location: "", avatar: "/objects/other-avatar",
    verified: false, accountType: "personal",
  }, [{
    id: postId, authorId: characterId, caption: "OTHER_OWNER_PUBLIC_POST",
    location: "", image: "/objects/other-post", createdAt: new Date(NOW - 180_000).toISOString(),
  }]), true);
  await seedUniverse(otherOwner, "sparse", seedState(
    { id: "sparse-character" },
    [{
      id: "sparse-post", authorId: "sparse-character", caption: "SPARSE_AUTHOR_POST",
      location: "", image: "", createdAt: new Date(NOW - 240_000).toISOString(),
    }],
  ), true);

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

test("archived public/private targets disappear from all social URLs and paginated feed, then restore", async () => {
  for (const universeId of ["primary", "studio"]) {
    const scope = and(eq(echoUniversesTable.ownerId, targetOwner), eq(echoUniversesTable.universeId, universeId));
    const [before] = await db.select().from(echoUniversesTable).where(scope);
    const story = (before.state.stories as Array<{ id: string }>)[0];
    const paths = ["", "/posts", `/posts/${postId}`, "/stories", `/stories/${story.id}`];
    for (const suffix of paths) assert.equal((await get(targetOwner,
      targetPath(targetOwner, universeId, characterId, suffix))).status, 200);
    await manageUniverse(targetOwner, universeId, { action: "archive", expectedRevision: 1 });
    for (const owner of [targetOwner, viewerOwner, otherOwner]) {
      for (const suffix of paths) {
        const response = await get(owner, targetPath(targetOwner, universeId, characterId, suffix) +
          (owner === viewerOwner ? viewerQuery() : ""));
        assert.equal(response.status, 404);
        assert.deepEqual(await response.json(), { error: "SOCIAL_CONTENT_NOT_FOUND" });
        assert.equal(response.headers.get("cache-control"), "private, no-store");
      }
    }
    let cursor: string | null = null;
    do {
      const feed = await get(viewerOwner, "/social/feed" + viewerQuery() +
        "&limit=1" + (cursor ? `&cursor=${encodeURIComponent(cursor)}` : ""));
      assert.equal(feed.status, 200);
      const body = await feed.json();
      assert.ok(body.items.every((item: { identity: CharacterIdentity }) =>
        item.identity.ownerId !== targetOwner || item.identity.universeId !== universeId));
      cursor = body.nextCursor;
    } while (cursor);
    await manageUniverse(targetOwner, universeId, { action: "restore", expectedRevision: 2 });
    const [restored] = await db.select().from(echoUniversesTable).where(scope);
    assert.deepEqual(restored.state, before.state);
    assert.equal(restored.sharingEnabled, before.sharingEnabled);
    for (const suffix of paths) assert.equal((await get(targetOwner,
      targetPath(targetOwner, universeId, characterId, suffix))).status, 200);
    assert.equal((await get(viewerOwner, targetPath(targetOwner, universeId) + viewerQuery())).status, 200);
  }
});

test("archived selected viewer has no direct or aggregate access even to public targets", async () => {
  await manageUniverse(viewerOwner, "primary", { action: "archive", expectedRevision: 1 });
  assert.equal((await get(viewerOwner, "/social/feed" + viewerQuery())).status, 404);
  for (const universe of ["primary", "studio"]) {
    assert.equal((await get(viewerOwner, targetPath(targetOwner, universe) + viewerQuery())).status, 404);
  }
  await manageUniverse(viewerOwner, "primary", { action: "restore", expectedRevision: 2 });
  assert.equal((await get(viewerOwner, "/social/feed" + viewerQuery())).status, 200);
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "studio") + viewerQuery())).status, 200);
});

test("restoration never enables sharing or bypasses private pending/stranger rules", async () => {
  const scope = and(eq(echoUniversesTable.ownerId, targetOwner), eq(echoUniversesTable.universeId, "primary"));
  await manageUniverse(targetOwner, "primary", { action: "archive", expectedRevision: 1 });
  await manageUniverse(targetOwner, "primary", { action: "restore", expectedRevision: 2 });
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery())).status, 200);
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery("pending-viewer"))).status, 404);
  assert.equal((await get(otherOwner, targetPath(targetOwner, "primary"))).status, 404);
  await db.update(echoUniversesTable).set({ sharingEnabled: false }).where(scope);
  await manageUniverse(targetOwner, "primary", { action: "archive", expectedRevision: 3 });
  await manageUniverse(targetOwner, "primary", { action: "restore", expectedRevision: 4 });
  assert.equal((await get(targetOwner, targetPath(targetOwner, "primary"))).status, 200);
  assert.equal((await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery())).status, 404);
  assert.equal((await db.select().from(echoUniversesTable).where(scope))[0].sharingEnabled, false);
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
  assert.equal(
    (await get(targetOwner, targetPath(targetOwner, "studio") + viewerQuery(characterId, "primary"))).status,
    404,
    "a same-owner viewer in primary cannot read a character from studio as part of that universe",
  );
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
    items: Array<{
      identity: CharacterIdentity;
      author: Record<string, unknown>;
      post: Record<string, unknown>;
    }>;
    totalCount?: unknown;
  };
  const captions = acceptedBody.items.map((item) => item.post.caption);
  assert.ok(captions.includes("PRIVATE_POST_NEWEST"));
  assert.ok(captions.includes("PUBLIC_STUDIO_POST"));
  assert.ok(captions.includes("OTHER_OWNER_PUBLIC_POST"));
  assert.ok(captions.includes("VIEWER_OWN_POST"));
  assert.equal("totalCount" in acceptedBody, false);
  assert.equal(acceptedBody.items.some((item) => "comments" in item.post || "displayMetrics" in item.post), false);
  const repeatedIdItems = acceptedBody.items.filter((item) => item.post.id === postId);
  assert.deepEqual(
    repeatedIdItems.map((item) =>
      `${item.identity.ownerId}/${item.identity.universeId}/${item.identity.characterId}/${item.post.id}`,
    ).sort(),
    [
      `${targetOwner}/primary/${characterId}/${postId}`,
      `${targetOwner}/studio/${characterId}/${postId}`,
      `${otherOwner}/primary/${characterId}/${postId}`,
    ].sort(),
  );
  const studioItem = repeatedIdItems.find((item) => item.identity.ownerId === targetOwner && item.identity.universeId === "studio");
  const otherOwnerItem = repeatedIdItems.find((item) => item.identity.ownerId === otherOwner);
  const privatePrimaryItem = repeatedIdItems.find((item) => item.identity.ownerId === targetOwner && item.identity.universeId === "primary");
  assert.equal(studioItem?.author.displayName, "Public Character");
  assert.equal(studioItem?.author.handle, "public-character");
  assert.equal(studioItem?.author.avatar, "/objects/public-avatar");
  assert.equal(studioItem?.author.verified, false);
  assert.equal(otherOwnerItem?.author.displayName, "Other Owner");
  assert.equal(privatePrimaryItem?.author.displayName, "Private Character");
  for (const item of repeatedIdItems) {
    assert.deepEqual(Object.keys(item.identity).sort(), ["characterId", "ownerId", "universeId"]);
    assert.deepEqual(Object.keys(item.author).sort(), ["avatar", "displayName", "handle", "verified"]);
    for (const hidden of [
      "bio", "occupation", "accountType", "displayMetrics",
      "providerRef", "identity", "configuration", "likes", "savedBy", "comments",
    ]) {
      assert.equal(hidden in item.author, false, `author must not expose ${hidden}`);
      assert.equal(hidden in item.post, false, `post must not expose ${hidden}`);
    }
  }
  const sparseAuthorItem = acceptedBody.items.find((item) =>
    item.identity.ownerId === otherOwner &&
    item.identity.universeId === "sparse" &&
    item.post.id === "sparse-post",
  );
  assert.deepEqual(sparseAuthorItem?.author, {}, "missing presentation fields must be omitted, not synthesized");

  const pendingBody = await (await get(viewerOwner, feed("pending-viewer"))).json() as {
    items: Array<{ identity: CharacterIdentity; author: Record<string, unknown>; post: Record<string, unknown> }>;
  };
  assert.equal(pendingBody.items.some((item) =>
    item.identity.ownerId === targetOwner &&
    item.identity.universeId === "primary" &&
    (item.post.caption === "PRIVATE_POST_NEWEST" || item.author.handle === "private-character"),
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
  const first = await firstResponse.json() as {
    items: Array<{ identity: CharacterIdentity; author: Record<string, unknown>; post: { id: string; authorId: string } }>;
    nextCursor: string | null;
  };
  assert.equal(first.items.length, 2);
  assert.ok(first.nextCursor);
  const second = await get(viewerOwner, `${route}&limit=2&cursor=${encodeURIComponent(first.nextCursor!)}`);
  const secondBody = await second.json() as {
    items: Array<{ identity: CharacterIdentity; author: Record<string, unknown>; post: { id: string; authorId: string } }>;
  };
  for (const item of [...first.items, ...secondBody.items]) {
    assert.equal(item.identity.characterId, item.post.authorId);
    if ("displayName" in item.author) assert.equal(typeof item.author.displayName, "string");
  }
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

test("sharing disabled hides cross-owner public and followed-private reads before pagination", async () => {
  await db.update(echoUniversesTable).set({ sharingEnabled: false }).where(and(
    eq(echoUniversesTable.ownerId, targetOwner),
    inArray(echoUniversesTable.universeId, ["primary", "studio"]),
  ));
  await db.update(echoUniversesTable).set({ sharingEnabled: false }).where(and(
    eq(echoUniversesTable.ownerId, otherOwner),
    inArray(echoUniversesTable.universeId, ["primary", "sparse"]),
  ));

  // An accepted follow cannot bypass the universe-level denial for private content.
  assert.equal(
    (await get(viewerOwner, targetPath(targetOwner, "primary") + viewerQuery())).status,
    404,
  );
  // Public characters and direct IDs are also hidden while their universe is off.
  assert.equal(
    (await get(viewerOwner, targetPath(targetOwner, "studio"))).status,
    404,
  );
  assert.equal(
    (await get(viewerOwner, targetPath(targetOwner, "studio", characterId, "/posts"))).status,
    404,
  );
  assert.equal(
    (await get(viewerOwner, targetPath(targetOwner, "studio", characterId, `/posts/${postId}`))).status,
    404,
  );
  assert.equal(
    (await get(viewerOwner, targetPath(targetOwner, "studio", characterId, "/stories"))).status,
    404,
  );
  assert.equal(
    (await get(viewerOwner, targetPath(targetOwner, "studio", characterId, "/stories/public-story"))).status,
    404,
  );

  // The creator still reads their own same-universe content with sharing off.
  assert.equal((await get(targetOwner, targetPath(targetOwner, "primary"))).status, 200);
  assert.equal((await get(targetOwner, targetPath(targetOwner, "primary", characterId, "/posts"))).status, 200);

  const response = await get(
    viewerOwner,
    `/social/feed?viewerUniverseId=primary&viewerCharacterId=accepted-viewer&limit=1`,
  );
  assert.equal(response.status, 200);
  const body = await response.json() as {
    items: Array<{ identity: CharacterIdentity; post: Record<string, unknown> }>;
    nextCursor: string | null;
  };
  assert.deepEqual(body.items.map((item) => item.post.caption), ["VIEWER_OWN_POST"]);
  assert.equal(body.items.some((item) =>
    item.identity.ownerId === targetOwner || item.identity.ownerId === otherOwner,
  ), false);
  assert.equal(body.nextCursor, null, "denied posts must be filtered before page boundaries are computed");
});
