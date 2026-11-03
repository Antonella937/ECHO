import test, { after, before } from "node:test";
import assert from "node:assert/strict";
import { createHash, randomUUID } from "node:crypto";
import express, { type RequestHandler } from "express";
import { createServer } from "node:http";
import type { AddressInfo } from "node:net";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  echoUniversesTable,
  echoVisionAnalysesTable,
  echoVisionMediaRefsTable,
  echoVisionPostSummariesTable,
} from "@workspace/db";
import { SaveUniverseBody, type SocialState } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { createVisionAnalysisRouter } from "../src/routes/vision-analysis";
import { readUniverse } from "../src/lib/universeRepository";
import { VisionService, buildVisionPostSummary } from "../src/vision/service";
import type { VisionAnalysis } from "../src/vision/contracts";

const owners = {
  alpha: `vision-active-alpha-${randomUUID()}`,
  beta: `vision-active-beta-${randomUUID()}`,
};
const imagePath = "/objects/uploads/vision-active-universe-shared-image";
const storyImagePath = "/objects/uploads/vision-active-universe-shared-story";
const postId = "vision-shared-post-id";
const mediaId = "vision-shared-media-id";
const storyId = "vision-shared-story-id";
const postImageHash = createHash("sha256").update("synthetic-post-image").digest("hex");
const storyImageHash = createHash("sha256").update("synthetic-story-image").digest("hex");

const analysisFor = (marker: string): VisionAnalysis => ({
  sceneDescription: `Escena sintética identificada como ${marker}.`,
  setting: "Fixture aislado de prueba",
  objects: [{
    label: marker,
    category: "object",
    attributes: ["dato sintético"],
    position: "center",
    confidence: 1,
  }],
  people: { count: 0, nonIdentifyingDetails: [] },
  activities: [],
  dominantColors: ["gris"],
  visibleText: [],
  notableDetails: [marker],
  uncertainty: [],
});

function stateFor(marker: string, location: string): SocialState {
  const state = createSeedState();
  state.posts = state.posts.slice(0, 1);
  const post = state.posts[0]!;
  post.id = postId;
  post.authorId = "mar";
  post.caption = "Caption idéntico para comprobar colisiones.";
  post.location = location;
  post.media = [{ id: mediaId, type: "image", url: imagePath }];
  post.image = imagePath;

  state.stories = state.stories.slice(0, 1);
  const story = state.stories[0]!;
  story.id = storyId;
  story.authorId = "mar";
  story.image = storyImagePath;

  const mar = state.characters.find((character) => character.id === "mar")!;
  if (mar.configuration) mar.configuration.personality.description = `PERSONALITY_${marker}`;
  return SaveUniverseBody.parse({ state, expectedRevision: 1 }).state;
}

const states = {
  alphaPrimary: stateFor("ALPHA_PRIMARY", "Lugar primary"),
  alphaStudio: stateFor("ALPHA_STUDIO", "Lugar studio"),
  betaPrimary: stateFor("BETA_PRIMARY", "Lugar beta"),
};

function summaryHash(state: SocialState): string {
  const post = state.posts.find((item) => item.id === postId)!;
  return createHash("sha256").update(JSON.stringify({
    items: [{ id: mediaId, type: "image", path: imagePath }],
    caption: post.caption ?? "",
    location: post.location ?? "",
  })).digest("hex");
}

async function seedUniverse(ownerId: string, universeId: string, state: SocialState): Promise<void> {
  await db.insert(echoUniversesTable).values({
    ownerId,
    universeId,
    revision: universeId === "primary" ? 4 : 9,
    state: state as unknown as Record<string, unknown>,
    updatedAt: new Date(),
  });
}

async function seedVisionRows(ownerId: string, universeId: string, state: SocialState, marker: string): Promise<void> {
  const postAnalysis = analysisFor(`${marker}_POST`);
  const storyAnalysis = analysisFor(`${marker}_STORY`);
  await db.insert(echoVisionAnalysesTable).values([
    {
      id: randomUUID(), ownerId, universeId, contentHash: postImageHash, mimeType: "image/png",
      byteSize: 128, status: "complete", provider: "synthetic", model: "synthetic",
      analysis: postAnalysis, updatedAt: new Date(),
    },
    {
      id: randomUUID(), ownerId, universeId, contentHash: storyImageHash, mimeType: "image/png",
      byteSize: 96, status: "complete", provider: "synthetic", model: "synthetic",
      analysis: storyAnalysis, updatedAt: new Date(),
    },
  ]);
  await db.insert(echoVisionMediaRefsTable).values([
    {
      ownerId, universeId, entityType: "post", entityId: postId, mediaId, position: 0,
      contentHash: postImageHash, sourcePath: imagePath,
    },
    {
      ownerId, universeId, entityType: "story", entityId: storyId, mediaId: `story:${storyId}`,
      position: 0, contentHash: storyImageHash, sourcePath: storyImagePath,
    },
  ]);
  const post = state.posts.find((item) => item.id === postId)!;
  await db.insert(echoVisionPostSummariesTable).values({
    ownerId,
    universeId,
    postId,
    contentHash: summaryHash(state),
    summary: buildVisionPostSummary(postId, post.caption ?? "", [{
      mediaId,
      position: 0,
      analysis: postAnalysis,
    }]) as unknown as Record<string, unknown>,
    updatedAt: new Date(),
  });
}

before(async () => {
  await seedUniverse(owners.alpha, "primary", states.alphaPrimary);
  await seedUniverse(owners.alpha, "studio", states.alphaStudio);
  await seedUniverse(owners.beta, "primary", states.betaPrimary);
  await seedVisionRows(owners.alpha, "primary", states.alphaPrimary, "ALPHA_PRIMARY");
  await seedVisionRows(owners.alpha, "studio", states.alphaStudio, "ALPHA_STUDIO");
  await seedVisionRows(owners.beta, "primary", states.betaPrimary, "BETA_PRIMARY");
});

after(async () => {
  await db.delete(echoVisionPostSummariesTable).where(inArray(echoVisionPostSummariesTable.ownerId, Object.values(owners)));
  await db.delete(echoVisionMediaRefsTable).where(inArray(echoVisionMediaRefsTable.ownerId, Object.values(owners)));
  await db.delete(echoVisionAnalysesTable).where(inArray(echoVisionAnalysesTable.ownerId, Object.values(owners)));
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, Object.values(owners)));
  await pool.end();
});

test("Vision persisted is isolated by owner + universe + repeated post/story/media IDs", async () => {
  const service = new VisionService();
  const postInput = { characterId: "mar", situation: "comment" as const, postId };

  const alphaPrimary = await service.loadContext(owners.alpha, states.alphaPrimary, postInput);
  const alphaStudio = await service.loadContext(owners.alpha, states.alphaStudio, {
    ...postInput,
    universeId: "studio",
  });
  const betaPrimary = await service.loadContext(owners.beta, states.betaPrimary, postInput);

  assert.equal(alphaPrimary.analyses[`post:${postId}:${mediaId}`]?.objects[0]?.label, "ALPHA_PRIMARY_POST");
  assert.equal(alphaStudio.analyses[`post:${postId}:${mediaId}`]?.objects[0]?.label, "ALPHA_STUDIO_POST");
  assert.equal(betaPrimary.analyses[`post:${postId}:${mediaId}`]?.objects[0]?.label, "BETA_PRIMARY_POST");
  assert.match(alphaPrimary.postSummaries[postId]?.overallDescription ?? "", /ALPHA_PRIMARY_POST/);
  assert.match(alphaStudio.postSummaries[postId]?.overallDescription ?? "", /ALPHA_STUDIO_POST/);
  assert.match(betaPrimary.postSummaries[postId]?.overallDescription ?? "", /BETA_PRIMARY_POST/);
  assert.doesNotMatch(JSON.stringify(alphaStudio), /ALPHA_PRIMARY_POST|BETA_PRIMARY_POST/);

  const alphaStory = await service.loadContext(owners.alpha, states.alphaStudio, {
    characterId: "mar",
    situation: "comment",
    storyId,
    universeId: "studio",
  });
  assert.equal(alphaStory.analyses[`story:${storyId}:story:${storyId}`]?.objects[0]?.label, "ALPHA_STUDIO_STORY");
});

test("HTTP Vision route propagates universeId for posts and Stories and rejects foreign/missing universes before analysis", async () => {
  const calls: Array<{ ownerId: string; universeId: string; marker: string; entityId: string }> = [];

  async function postVision(ownerId: string, body: Record<string, unknown>) {
    const app = express();
    app.use(express.json());
    const authenticate: RequestHandler = (req, _res, next) => {
      req.userId = ownerId;
      next();
    };
    app.use(createVisionAnalysisRouter({
      authenticate,
      read: readUniverse,
      analyzePost: async (id, state, entityId, universeId) => {
        calls.push({
          ownerId: id,
          universeId,
          marker: state.posts.find((post) => post.id === entityId)?.location ?? "",
          entityId,
        });
        return { entityType: "post", entityId, summary: null, items: [], skippedVideoCount: 0 };
      },
      analyzeStory: async (id, state, entityId, universeId) => {
        calls.push({
          ownerId: id,
          universeId,
          marker: state.posts.find((post) => post.id === postId)?.location ?? "",
          entityId,
        });
        return { entityType: "story", entityId, items: [] };
      },
    }));
    const server = createServer(app);
    await new Promise<void>((resolve, reject) => {
      server.once("error", reject);
      server.listen(0, "127.0.0.1", resolve);
    });
    try {
      const address = server.address() as AddressInfo;
      const response = await fetch(`http://127.0.0.1:${address.port}/ai-engine/vision/analyze`, {
        method: "POST",
        headers: { "content-type": "application/json", connection: "close" },
        body: JSON.stringify(body),
      });
      return { status: response.status, body: await response.json() as Record<string, unknown> };
    } finally {
      await new Promise<void>((resolve, reject) => {
        server.close((error) => error ? reject(error) : resolve());
      });
    }
  }

  const selectedPost = await postVision(owners.alpha, { postId, universeId: "studio" });
  assert.equal(selectedPost.status, 200);
  assert.deepEqual(calls.at(-1), {
    ownerId: owners.alpha,
    universeId: "studio",
    marker: "Lugar studio",
    entityId: postId,
  });

  const fallbackPost = await postVision(owners.alpha, { postId });
  assert.equal(fallbackPost.status, 200);
  assert.equal(calls.at(-1)?.universeId, "primary");
  assert.equal(calls.at(-1)?.marker, "Lugar primary");

  const selectedStory = await postVision(owners.alpha, { storyId, universeId: "studio" });
  assert.equal(selectedStory.status, 200);
  assert.equal(calls.at(-1)?.universeId, "studio");
  assert.equal(calls.at(-1)?.marker, "Lugar studio");
  assert.equal(calls.at(-1)?.entityId, storyId);

  const betaPost = await postVision(owners.beta, { postId, universeId: "primary" });
  assert.equal(betaPost.status, 200);
  assert.equal(calls.at(-1)?.ownerId, owners.beta);
  assert.equal(calls.at(-1)?.marker, "Lugar beta");

  const callsBeforeReject = calls.length;
  const foreignUniverse = await postVision(owners.beta, { postId, universeId: "studio" });
  assert.equal(foreignUniverse.status, 404);
  assert.equal(foreignUniverse.body.error, "UNIVERSE_NOT_FOUND");
  const missingUniverse = await postVision(owners.alpha, { storyId, universeId: "does-not-exist" });
  assert.equal(missingUniverse.status, 404);
  assert.equal(missingUniverse.body.error, "UNIVERSE_NOT_FOUND");
  assert.equal(calls.length, callsBeforeReject, "invalid universes must fail before Vision analysis/provider use");
});
