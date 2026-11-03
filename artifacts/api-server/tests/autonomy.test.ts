import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import { and, eq, inArray } from "drizzle-orm";
import { SaveUniverseBody, type CharacterDecision, type SocialState } from "@workspace/api-zod";
import {
  db,
  pool,
  echoAutonomyCharactersTable,
  echoAutonomyOwnersTable,
  echoAutonomyRunsTable,
  echoAutonomyWorkerLeasesTable,
  echoUniversesTable,
} from "@workspace/db";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { applyAutonomyDecision, executeAutonomyDecision } from "../src/autonomy/executor";
import { chooseAutonomyOpportunity, liveEligibility, type Opportunity } from "../src/autonomy/policy";
import { runAutonomyDryRun, runAutonomyLiveCycle } from "../src/autonomy/service";
import { buildCharacterContext } from "../src/ai-engine/context";
import { previewDecision } from "../src/ai-engine/engine";
import { postMedia } from "../../echo/src/domain/post-media";
import type { AutonomyRepository } from "../src/autonomy/service";
import type { TextProvider } from "../src/ai-engine/contracts";
import { AUTONOMY_LIVE_EXECUTION_ENABLED, DEFAULT_CHARACTER_CONTROL } from "../src/autonomy/constants";
import {
  claimAutonomyWorkerLease,
  completeDryRun,
  releaseAutonomyWorkerLease,
  listLiveOptInTargets,
  getExecutedActionHistory,
  updateCharacterControl,
  updateOwnerKillSwitch,
  readOwnerControls,
  reserveDryRun,
} from "../src/autonomy/repository";
import {
  AUTONOMY_WORKER_INTERVAL_MS,
  runAutonomyWorkerTick,
  startAutonomyWorker,
} from "../src/autonomy/worker";
import { startAutonomyBackgroundWorker } from "../src/autonomy/runtime";

const NOW = new Date("2026-11-03T12:00:00.000Z");
const dbOwners = [`autonomy-synthetic-${crypto.randomUUID()}`, `autonomy-synthetic-${crypto.randomUUID()}`];
function syntheticOwnerId() {
  const ownerId = `autonomy-synthetic-${crypto.randomUUID()}`;
  dbOwners.push(ownerId);
  return ownerId;
}

after(async () => {
  await db.delete(echoAutonomyRunsTable).where(inArray(echoAutonomyRunsTable.ownerId, dbOwners));
  await db.delete(echoAutonomyCharactersTable).where(inArray(echoAutonomyCharactersTable.ownerId, dbOwners));
  await db.delete(echoAutonomyOwnersTable).where(inArray(echoAutonomyOwnersTable.ownerId, dbOwners));
  await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, dbOwners));
  await pool.end();
});

function fixture() {
  const sourceState = createSeedState();
  const sourceMar = sourceState.characters.find((character) => character.id === "mar")!;
  sourceMar.configuration = defaultCharacterConfig(sourceMar);
  const normalized = SaveUniverseBody.safeParse({ state: sourceState, expectedRevision: 1 });
  if (!normalized.success) throw new Error("SYNTHETIC_FIXTURE_INVALID");
  const state: SocialState = normalized.data.state;
  state.posts = [];
  state.comments = [];
  state.stories = [];
  state.messages = [];
  const mar = state.characters.find((character) => character.id === "mar")!;
  const configuration = mar.configuration;
  if (!configuration) throw new Error("SYNTHETIC_CHARACTER_CONFIGURATION_MISSING");
  configuration.social.activity = "high";
  configuration.social.sociability = "high";
  configuration.social.spontaneity = "high";
  configuration.social.allowSilence = false;
  configuration.currentState.lastActivityAt = null;
  return { state, mar };
}

const postOpportunity = { situation: "post" } as Opportunity;
const postDecision = (text = "Ensayo y café.") => ({
  action: "draft",
  situation: "post",
  text,
  reason: "Synthetic executor test.",
  suggestedDelayMinutes: 0,
  contextSections: ["identity"],
}) satisfies CharacterDecision;

async function insertSyntheticUniverse(ownerId: string, state: SocialState, now: Date, revision = 1, universeId = "primary") {
  await db.insert(echoUniversesTable).values({
    ownerId,
    universeId,
    revision,
    state: state as unknown as Record<string, unknown>,
    updatedAt: now,
  });
}

async function insertAutonomyRun(input: {
  ownerId: string;
  characterId?: string;
  universeId?: string;
  key?: string;
  status?: string;
  action?: string | null;
  situation?: string | null;
  now?: Date;
  updatedAt?: Date;
  attemptCount?: number;
  sourceRevision?: number;
}) {
  const now = input.now ?? new Date();
  const [run] = await db.insert(echoAutonomyRunsTable).values({
    ownerId: input.ownerId,
    universeId: input.universeId ?? "primary",
    characterId: input.characterId ?? "mar",
    idempotencyKey: input.key ?? crypto.randomUUID(),
    status: input.status ?? "running",
    action: input.action ?? null,
    situation: input.situation ?? null,
    sourceRevision: input.sourceRevision ?? 1,
    attemptCount: input.attemptCount ?? 1,
    createdAt: now,
    updatedAt: input.updatedAt ?? now,
  }).returning({ id: echoAutonomyRunsTable.id });
  return String(run.id);
}

async function setupExecutorOwner(input: {
  ownerId: string;
  universeId?: string;
  state?: SocialState;
  now?: Date;
  killSwitchEngaged?: boolean;
  characterEnabled?: boolean;
  maxActionsPerDay?: number;
  minCooldownMinutes?: number;
}) {
  const now = input.now ?? new Date();
  const { state, mar } = fixture();
  const universe = input.state ?? state;
  const universeId = input.universeId ?? "primary";
  await insertSyntheticUniverse(input.ownerId, universe, now, 1, universeId);
  await db.insert(echoAutonomyOwnersTable).values({
    ownerId: input.ownerId,
    killSwitchEngaged: input.killSwitchEngaged ?? false,
    updatedAt: now,
  });
  await db.insert(echoAutonomyCharactersTable).values({
    ownerId: input.ownerId,
    universeId,
    characterId: mar.id,
    enabled: input.characterEnabled ?? true,
    maxActionsPerDay: input.maxActionsPerDay ?? 2,
    minCooldownMinutes: input.minCooldownMinutes ?? 60,
    updatedAt: now,
  });
  const runId = await insertAutonomyRun({ ownerId: input.ownerId, universeId, now });
  return { state: universe, mar, runId };
}

function addNoahRelationship(mar: ReturnType<typeof fixture>["mar"], noahId: string) {
  mar.configuration!.relationships = [{
    id: "friendship", targetId: noahId, preset: "friend", customLabel: "",
    description: "Configured friend", closeness: 70, trust: 60, attraction: null, tension: null,
  }];
  mar.configuration!.social.postsFrequency = "rare";
  mar.configuration!.social.initiatesDMs = "rare";
}

function selectLateCandidate() {
  const values = [0, 0.95];
  return () => values.shift() ?? 0.95;
}

test("planner chooses silence before spending a model call", () => {
  const { state, mar } = fixture();
  const result = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0.99 });
  assert.equal(result.situation, null);
  assert.equal(result.reasonCode, "SILENCE_SELECTED");
});

test("autonomous text posts have no fake media while photo and video projections stay intact", () => {
  const { state, mar } = fixture();
  const created = applyAutonomyDecision(
    state,
    mar.id,
    { situation: "post" } as Opportunity,
    {
      action: "draft", situation: "post", text: "Ensayo y café.",
      reason: "Post breve después del ensayo.", suggestedDelayMinutes: 0, contextSections: ["identity"],
    },
    NOW,
    () => "synthetic-text-post",
  );
  const textPost = created.state.posts[0]!;
  assert.equal(created.changed, true);
  assert.equal(textPost.image, "");
  assert.deepEqual(postMedia(textPost), []);
  assert.equal(SaveUniverseBody.safeParse({ state: created.state, expectedRevision: 1 }).success, true);
  assert.equal(state.posts.length, 0);

  const legacyPhoto = { id: "legacy-photo", image: "asset://photo" } as Parameters<typeof postMedia>[0];
  assert.deepEqual(postMedia(legacyPhoto), [
    { id: "legacy-photo:legacy", type: "image", url: "asset://photo" },
  ]);
  const videoCarousel = {
    id: "video-carousel", image: "",
    media: [{ id: "clip-1", type: "video" as const, url: "asset://video" }],
  } as Parameters<typeof postMedia>[0];
  assert.deepEqual(postMedia(videoCarousel), videoCarousel.media);
});

test("planner considers non-repeating post/comment likes and text-based story/DM reactions", () => {
  const postFixture = fixture();
  const noah = postFixture.state.characters.find((character) => character.id === "noah")!;
  addNoahRelationship(postFixture.mar, noah.id);
  postFixture.state.posts.push({
    id: "likeable-post", authorId: noah.id, caption: "Ensayo hasta tarde", location: "",
    createdAt: new Date(NOW.getTime() - 60 * 60_000), likes: [], savedBy: [], commentsEnabled: true,
  } as unknown as (typeof postFixture.state.posts)[number]);
  const likePost = chooseAutonomyOpportunity({
    state: postFixture.state, character: postFixture.mar, history: [], now: NOW, random: selectLateCandidate(),
  });
  assert.equal(likePost.situation, "like_post");
  assert.equal(likePost.postId, "likeable-post");

  const commentFixture = fixture();
  const commentNoah = commentFixture.state.characters.find((character) => character.id === "noah")!;
  addNoahRelationship(commentFixture.mar, commentNoah.id);
  commentFixture.state.posts.push({
    id: "comment-post", authorId: commentNoah.id, caption: "Ensayo", location: "",
    createdAt: new Date(NOW.getTime() - 60 * 60_000), likes: [commentFixture.mar.id], savedBy: [], commentsEnabled: true,
  } as unknown as (typeof commentFixture.state.posts)[number]);
  commentFixture.state.comments.push({
    id: "likeable-comment", postId: "comment-post", authorId: commentNoah.id, text: "¿A qué hora?",
    createdAt: new Date(NOW.getTime() - 30 * 60_000), parentId: null, replyToAuthorId: null, likes: [], origin: "user",
  });
  const likeComment = chooseAutonomyOpportunity({
    state: commentFixture.state, character: commentFixture.mar, history: [], now: NOW, random: selectLateCandidate(),
  });
  assert.equal(likeComment.situation, "like_comment");
  assert.equal(likeComment.commentId, "likeable-comment");

  const storyFixture = fixture();
  const storyNoah = storyFixture.state.characters.find((character) => character.id === "noah")!;
  addNoahRelationship(storyFixture.mar, storyNoah.id);
  storyFixture.state.stories.push({
    id: "reactable-story", authorId: storyNoah.id, image: "asset:test", caption: "Prueba de sonido",
    createdAt: new Date(NOW.getTime() - 30 * 60_000), seenBy: [storyFixture.mar.id], reactions: [], origin: "user",
  });
  const storyReaction = chooseAutonomyOpportunity({
    state: storyFixture.state, character: storyFixture.mar, history: [], now: NOW, random: selectLateCandidate(),
  });
  assert.equal(storyReaction.situation, "story_reaction");
  assert.equal(storyReaction.storyId, "reactable-story");
  const storyContext = JSON.parse(buildCharacterContext(storyFixture.state, {
    characterId: storyFixture.mar.id, situation: "story_reaction", storyId: storyReaction.storyId!,
  }, NOW).serialized) as {
    target: { story: { caption: string; mediaNotAnalyzed: boolean } };
    personality: unknown;
    relationships: Array<{ target: { id: string } }>;
    recentSocial: { stories: Array<{ id: string }> };
  };
  assert.equal(storyContext.target.story.caption, "Prueba de sonido");
  assert.equal(storyContext.target.story.mediaNotAnalyzed, true);
  assert.deepEqual(storyContext.personality, storyFixture.mar.configuration!.personality);
  assert.equal(storyContext.relationships[0].target.id, storyNoah.id);
  assert.ok(storyContext.recentSocial.stories.some(item => item.id === "reactable-story"));

  const dmFixture = fixture();
  const dmNoah = dmFixture.state.characters.find((character) => character.id === "noah")!;
  addNoahRelationship(dmFixture.mar, dmNoah.id);
  dmFixture.state.messages.push({
    id: "reactable-message", threadId: "thread-1", senderId: dmNoah.id, recipientId: dmFixture.mar.id,
    text: "Llegué al ensayo", createdAt: new Date(NOW.getTime() - 30 * 60_000), storyId: null, postId: null,
    readBy: [dmFixture.mar.id], reactions: [], origin: "user",
  });
  const dmReaction = chooseAutonomyOpportunity({
    state: dmFixture.state, character: dmFixture.mar, history: [], now: NOW, random: selectLateCandidate(),
  });
  assert.equal(dmReaction.situation, "dm_reaction");
  assert.equal(dmReaction.messageId, "reactable-message");
  const dmContext = JSON.parse(buildCharacterContext(dmFixture.state, {
    characterId: dmFixture.mar.id, situation: "dm_reaction", messageId: dmReaction.messageId!,
  }, NOW).serialized) as { target: { message: { text: string } }; recentSocial: { messages: Array<{ id: string }> } };
  assert.equal(dmContext.target.message.text, "Llegué al ensayo");
  assert.ok(dmContext.recentSocial.messages.some(item => item.id === "reactable-message"));
});

test("per-type caps and executed target history prevent repetitive likes", () => {
  const { state, mar } = fixture();
  const noah = state.characters.find((character) => character.id === "noah")!;
  state.follows[mar.id] = [noah.id];
  mar.configuration!.social.postsFrequency = "rare";
  state.posts.push({
    id: "likeable-post", authorId: noah.id, caption: "Ensayo", location: "",
    createdAt: new Date(NOW.getTime() - 60 * 60_000), likes: [], savedBy: [], commentsEnabled: true,
  } as unknown as (typeof state.posts)[number]);
  const lastAction = (targetId: string) => ({
    status: "executed", action: "like", situation: "like_post", targetId,
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
  });
  const sameTarget = chooseAutonomyOpportunity({
    state, character: mar, history: [lastAction("likeable-post")], now: NOW, random: selectLateCandidate(),
    minCooldownMinutes: 60, maxActionsPerDay: 10,
  });
  assert.notEqual(sameTarget.situation, "like_post");

  const capped = chooseAutonomyOpportunity({
    state, character: mar,
    history: [lastAction("p1"), lastAction("p2"), lastAction("p3")],
    now: NOW, random: selectLateCandidate(), minCooldownMinutes: 60, maxActionsPerDay: 10,
  });
  assert.notEqual(capped.situation, "like_post");

  const storyState = fixture();
  const storyNoah = storyState.state.characters.find((character) => character.id === "noah")!;
  storyState.state.follows[storyState.mar.id] = [storyNoah.id];
  storyState.state.stories.push({
    id: "story-under-cap", authorId: storyNoah.id, image: "asset:test", caption: "Prueba",
    createdAt: new Date(NOW.getTime() - 30 * 60_000), seenBy: [storyState.mar.id], reactions: [], origin: "user",
  });
  const recentExecuted = (situation: string, targetId: string) => ({
    status: "executed", action: "react", situation, targetId,
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
  });
  const storyCapped = chooseAutonomyOpportunity({
    state: storyState.state, character: storyState.mar,
    history: [recentExecuted("story_reaction", "old-story-1"), recentExecuted("story_reaction", "old-story-2")],
    now: NOW, random: selectLateCandidate(), minCooldownMinutes: 60, maxActionsPerDay: 10,
  });
  assert.notEqual(storyCapped.situation, "story_reaction");

  const messageState = fixture();
  const messageNoah = messageState.state.characters.find((character) => character.id === "noah")!;
  messageState.state.messages.push({
    id: "message-under-cap", threadId: "thread", senderId: messageNoah.id, recipientId: messageState.mar.id,
    text: "¿Venís?", createdAt: new Date(NOW.getTime() - 30 * 60_000),
    storyId: null, postId: null, readBy: [messageState.mar.id], reactions: [], origin: "user",
  });
  const dmCapped = chooseAutonomyOpportunity({
    state: messageState.state, character: messageState.mar,
    history: [recentExecuted("dm_reaction", "old-message-1"), recentExecuted("dm_reaction", "old-message-2")],
    now: NOW, random: selectLateCandidate(), minCooldownMinutes: 60, maxActionsPerDay: 10,
  });
  assert.notEqual(dmCapped.situation, "dm_reaction");
});

test("synthetic AI previews accept only correct non-text likes/reactions and never execute them", async () => {
  const { state, mar } = fixture();
  const noah = state.characters.find((character) => character.id === "noah")!;
  state.posts.push({
    id: "target-post", authorId: noah.id, caption: "Ensayo", location: "",
    createdAt: new Date(NOW.getTime() - 60 * 60_000), likes: [], savedBy: [], commentsEnabled: true,
  } as unknown as (typeof state.posts)[number]);
  state.stories.push({
    id: "target-story", authorId: noah.id, image: "asset:test", caption: "Prueba de sonido",
    createdAt: new Date(NOW.getTime() - 30 * 60_000), seenBy: [mar.id], reactions: [], origin: "user",
  });
  state.comments.push({
    id: "target-comment", postId: "target-post", authorId: noah.id, text: "Llegamos tarde al ensayo",
    createdAt: new Date(NOW.getTime() - 30 * 60_000), parentId: null, replyToAuthorId: null, likes: [], origin: "user",
  });
  state.messages.push({
    id: "target-message", threadId: "target-thread", senderId: noah.id, recipientId: mar.id,
    text: "Te guardé café", createdAt: new Date(NOW.getTime() - 20 * 60_000),
    storyId: null, postId: null, readBy: [mar.id], reactions: [], origin: "user",
  });
  const decision = (action: string, situation: string, reaction: string | null = null, text: string | null = null) => ({
    action, situation, reaction, text, reason: "Contexto social disponible.", suggestedDelayMinutes: 0,
    contextSections: ["identity"],
  });
  const fake = (value: unknown): TextProvider => ({
    name: "synthetic-only",
    complete: async () => ({ text: JSON.stringify(value), model: "synthetic:test" }),
  });
  const like = await previewDecision(fake(decision("like", "like_post")), state, {
    characterId: mar.id, situation: "like_post", postId: "target-post",
  }, 1, NOW);
  assert.equal(like.decision.action, "like");
  assert.equal(like.targetId, "target-post");
  assert.equal(like.executed, false);

  const commentLike = await previewDecision(fake(decision("like", "like_comment")), state, {
    characterId: mar.id, situation: "like_comment", postId: "target-post", commentId: "target-comment",
  }, 1, NOW);
  assert.equal(commentLike.decision.action, "like");
  assert.equal(commentLike.targetId, "target-comment");

  const reaction = await previewDecision(fake(decision("react", "story_reaction", "😂")), state, {
    characterId: mar.id, situation: "story_reaction", storyId: "target-story",
  }, 1, NOW);
  assert.equal(reaction.decision.reaction, "😂");
  assert.equal(reaction.targetId, "target-story");
  assert.equal(reaction.executed, false);

  const dmReaction = await previewDecision(fake(decision("react", "dm_reaction", "❤")), state, {
    characterId: mar.id, situation: "dm_reaction", messageId: "target-message",
  }, 1, NOW);
  assert.equal(dmReaction.decision.reaction, "❤");
  assert.equal(dmReaction.targetId, "target-message");

  await assert.rejects(
    previewDecision(fake(decision("draft", "like_post", null, "Me gusta")), state, {
      characterId: mar.id, situation: "like_post", postId: "target-post",
    }, 1, NOW),
    (error: unknown) => error instanceof Error && "diagnostic" in error &&
      error.diagnostic === "ACTION_NOT_ALLOWED_FOR_SITUATION",
  );
  await assert.rejects(
    previewDecision(fake(decision("react", "story_reaction", "💣")), state, {
      characterId: mar.id, situation: "story_reaction", storyId: "target-story",
    }, 1, NOW),
    (error: unknown) => error instanceof Error && "diagnostic" in error && error.diagnostic === "REACTION_NOT_ALLOWED",
  );
  await assert.rejects(
    previewDecision(fake(decision("react", "story_reaction", "😂", "Mandando reacción")), state, {
      characterId: mar.id, situation: "story_reaction", storyId: "target-story",
    }, 1, NOW),
    (error: unknown) => error instanceof Error && "diagnostic" in error && error.diagnostic === "NON_TEXT_ACTION_HAS_TEXT",
  );
  assert.equal(state.posts[0].likes.includes(mar.id), false);
  assert.equal(state.comments[0].likes.includes(mar.id), false);
  assert.equal(state.stories[0].reactions?.length, 0);
  assert.equal(state.messages[0].reactions?.length, 0);
});

test("routine and current state can suppress action during sleep", () => {
  const { state, mar } = fixture();
  mar.configuration!.currentState.activity = "sleeping";
  const result = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0 });
  assert.equal(result.reasonCode, "SLEEP_ROUTINE");
  assert.equal(result.situation, null);
});

test("recent real social activity enforces the per-character cooldown", () => {
  const { state, mar } = fixture();
  state.posts.push({
    id: "recent-manual-post", authorId: mar.id, createdAt: new Date(NOW.getTime() - 15 * 60_000),
  } as (typeof state.posts)[number]);
  const result = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0 });
  assert.equal(result.reasonCode, "COOLDOWN");
  assert.equal(result.situation, null);
});

test("completed-action history enforces the daily cap", () => {
  const { state, mar } = fixture();
  const history = [8, 10].map((hours) => ({
    status: "executed",
    action: "draft",
    situation: "comment",
    createdAt: new Date(NOW.getTime() - hours * 60 * 60_000),
  }));
  const result = chooseAutonomyOpportunity({
    state, character: mar, history, now: NOW, random: () => 0,
    minCooldownMinutes: 60, maxActionsPerDay: 2,
  });
  assert.equal(result.reasonCode, "DAILY_CAP");
  assert.equal(result.situation, null);
});

test("partial character sheet remains evaluable with conservative defaults", () => {
  const { state, mar } = fixture();
  mar.configuration = undefined;
  const result = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0 });
  assert.equal(result.situation, "post");
});

test("comment and DM candidates require real targets and an explicit relationship/history", () => {
  const { state, mar } = fixture();
  const noTargets = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0 });
  assert.equal(noTargets.situation, "post");

  const noah = state.characters.find((character) => character.id === "noah")!;
  state.posts.push({
    id: "unanswered-post", authorId: noah.id, commentsEnabled: true,
    createdAt: new Date(NOW.getTime() - 2 * 60 * 60_000),
  } as (typeof state.posts)[number]);
  mar.configuration!.relationships = [{
    id: "friendship", targetId: noah.id, preset: "friend", customLabel: "",
    description: "Existing configured relationship", closeness: 70, trust: 60, attraction: null, tension: null,
  }];
  const comment = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0.5 });
  assert.equal(comment.situation, "comment");
  assert.equal(comment.postId, "unanswered-post");
  state.comments.push({
    id: "replyable-comment", postId: "unanswered-post", authorId: noah.id, text: "¿Ensayo esta semana?",
    createdAt: new Date(NOW.getTime() - 60 * 60_000), parentId: null, replyToAuthorId: null,
    likes: [], origin: "user",
  });
  const reply = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: (() => {
    const values = [0, 0.45]; return () => values.shift() ?? 0.45;
  })() });
  assert.equal(reply.situation, "comment");
  assert.equal(reply.postId, "unanswered-post");
  assert.equal(reply.commentId, "replyable-comment");
  const built = buildCharacterContext(state, {
    characterId: mar.id, situation: "comment", postId: reply.postId!, commentId: reply.commentId!,
  }, NOW);
  const context = JSON.parse(built.serialized) as { target: { replyTo: { text: string } } };
  assert.equal(context.target.replyTo.text, "¿Ensayo esta semana?");
  const dm = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: (() => {
    const values = [0, 0.7]; return () => values.shift() ?? 0.7;
  })() });
  assert.equal(dm.situation, "dm");
  assert.equal(dm.recipientId, noah.id);
});

test("a missed routine window is not replayed as catch-up activity", () => {
  const { state, mar } = fixture();
  mar.configuration!.routine.timezone = "UTC";
  mar.configuration!.routine.entries = [{
    id: "past-once", title: "Earlier event", activity: "work", weekdays: [],
    start: "08:00", end: "09:00", location: "", recurrence: "once",
    date: "2026-11-02", flexibility: "medium",
  }];
  const result = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0 });
  assert.notEqual(result.reasonCode, "SLEEP_ROUTINE");
  assert.ok(["post", "comment", "dm", null].includes(result.situation));
});

test("kill switch and per-character opt-in gate live eligibility, never manual preview", () => {
  const { state, mar } = fixture();
  const opportunity = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0 });
  assert.equal(liveEligibility({ globalKillSwitchEngaged: true, characterEnabled: true, opportunity }), false);
  assert.equal(liveEligibility({ globalKillSwitchEngaged: false, characterEnabled: false, opportunity }), false);
  assert.equal(liveEligibility({ globalKillSwitchEngaged: false, characterEnabled: true, opportunity }), true);
});

test("dry run uses owner-scoped data, is idempotent, and does not mutate social state", async () => {
  const { state, mar } = fixture();
  const before = structuredClone(state);
  const ledger = new Map<string, { id: string; status: string }>();
  const completed: Array<{ id: string; status: string }> = [];
  const universesRead: string[] = [];
  const controlsRead: string[] = [];
  const historyRead: string[] = [];
  let providerCalls = 0;
  let reserves = 0;
  const repository: AutonomyRepository = {
    read: async (ownerId, universeId) => {
      universesRead.push(universeId ?? "primary");
      return ownerId === "owner-a" && universeId === "studio"
        ? { state, revision: 7 }
        : { state: null, revision: 0 };
    },
    readControls: async (ownerId, universeId) => {
      controlsRead.push(universeId ?? "primary");
      return {
        globalKillSwitchEngaged: false,
        liveExecutionEnabled: false,
        characters: new Map(ownerId === "owner-a" ? [[mar.id, {
          enabled: true, maxActionsPerDay: 2, minCooldownMinutes: 360,
        }]] : []),
      };
    },
    getExecutedHistory: async (_ownerId, _characterId, _since, universeId) => {
      historyRead.push(universeId ?? "primary");
      return [];
    },
    reserve: async (ownerId, _characterId, key, _revision, universeId) => {
      reserves += 1;
      const ledgerKey = `${ownerId}:${universeId ?? "primary"}:${key}`;
      const previous = ledger.get(ledgerKey);
      if (previous) return { kind: "duplicate" as const, runId: previous.id, status: previous.status, characterId: "mar" };
      const run = { id: String(ledger.size + 1), status: "running" };
      ledger.set(ledgerKey, run);
      return { kind: "created" as const, runId: run.id };
    },
    complete: async (_ownerId, runId, result, universeId) => {
      assert.equal(universeId, "studio");
      const run = [...ledger.values()].find((entry) => entry.id === runId);
      if (run) run.status = result.status;
      completed.push({ id: runId, status: result.status });
    },
  };
  const provider: TextProvider = {
    name: "synthetic-free-only",
    complete: async ({ context }) => {
      providerCalls += 1;
      const parsed = JSON.parse(context) as { situation: string };
      return {
        model: "synthetic:free",
        text: JSON.stringify({
          action: "none", situation: parsed.situation, text: null,
          reason: "Synthetic no-action decision.", suggestedDelayMinutes: 0, contextSections: ["identity"],
        }),
      };
    },
  };
  const input = {
    characterId: "mar",
    idempotencyKey: "00000000-0000-4000-8000-000000000001",
    universeId: "studio",
  };
  const first = await runAutonomyDryRun("owner-a", input, { repository, provider, now: NOW, random: () => 0 });
  const retry = await runAutonomyDryRun("owner-a", input, { repository, provider, now: NOW, random: () => 0 });
  assert.equal(first.preview?.decision.action, "none");
  assert.equal(first.socialActionsExecuted, false);
  assert.equal(first.liveExecutionEnabled, false);
  assert.equal(first.liveEligible, false);
  assert.equal(retry.status, "duplicate");
  assert.equal(providerCalls, 1);
  assert.equal(reserves, 2);
  assert.equal(completed.length, 1);
  assert.ok(universesRead.length > 0 && universesRead.every((id) => id === "studio"));
  assert.deepEqual(controlsRead, ["studio"]);
  assert.deepEqual(historyRead, ["studio"]);
  assert.deepEqual(state, before);
  await assert.rejects(
    runAutonomyDryRun("owner-b", input, { repository, provider, now: NOW, random: () => 0 }),
    /UNIVERSE_NOT_FOUND/,
  );
  assert.equal(providerCalls, 1);
});

test("PostgreSQL controls and idempotency are isolated by owner and rate-capped", async () => {
  const [ownerA, ownerB] = dbOwners;
  const defaults = await readOwnerControls(ownerA);
  assert.equal(defaults.globalKillSwitchEngaged, true);
  assert.equal(defaults.characters.get("nela"), undefined);

  await updateOwnerKillSwitch(ownerA, false);
  await updateCharacterControl(ownerA, "nela", true);
  const controlsA = await readOwnerControls(ownerA);
  const controlsB = await readOwnerControls(ownerB);
  assert.equal(controlsA.globalKillSwitchEngaged, false);
  assert.equal(controlsA.characters.get("nela")?.enabled, true);
  assert.equal(controlsB.globalKillSwitchEngaged, true);
  assert.equal(controlsB.characters.get("nela"), undefined);

  const key = crypto.randomUUID();
  const first = await reserveDryRun(ownerA, "nela", key, 1);
  assert.equal(first.kind, "created");
  const retry = await reserveDryRun(ownerA, "nela", key, 1);
  assert.equal(retry.kind, "duplicate");
  assert.equal(retry.runId, first.kind === "created" ? first.runId : null);
  assert.equal((await reserveDryRun(ownerA, "mar", key, 1)).kind, "idempotency_conflict");

  await reserveDryRun(ownerA, "nela", crypto.randomUUID(), 1);
  await reserveDryRun(ownerA, "nela", crypto.randomUUID(), 1);
  const capped = await reserveDryRun(ownerA, "nela", crypto.randomUUID(), 1);
  assert.equal(capped.kind, "rate_limited");

  const staleKey = crypto.randomUUID();
  const staleAt = new Date(Date.now() - 5 * 60_000);
  const [stale] = await db.insert(echoAutonomyRunsTable).values({
    ownerId: ownerB,
    characterId: "mar",
    idempotencyKey: staleKey,
    status: "running",
    sourceRevision: 1,
    createdAt: staleAt,
    updatedAt: staleAt,
  }).returning({ id: echoAutonomyRunsTable.id });
  const recovered = await reserveDryRun(ownerB, "mar", staleKey, 2);
  assert.equal(recovered.kind, "created");
  assert.equal(recovered.runId, String(stale.id));

  const otherOwner = await reserveDryRun(ownerB, "nela", key, 1);
  assert.equal(otherOwner.kind, "created");
});

test("PostgreSQL controls, idempotency, and execution history are isolated by universe", async () => {
  const ownerId = syntheticOwnerId();
  const primaryState = fixture().state;
  const alternateState = fixture().state;
  await insertSyntheticUniverse(ownerId, primaryState, NOW, 1, "primary");
  await insertSyntheticUniverse(ownerId, alternateState, NOW, 1, "studio");
  await updateOwnerKillSwitch(ownerId, false);
  await updateCharacterControl(ownerId, "mar", false, "primary");
  await updateCharacterControl(ownerId, "mar", true, "studio");

  const primaryControls = await readOwnerControls(ownerId, "primary");
  const studioControls = await readOwnerControls(ownerId, "studio");
  assert.equal(primaryControls.characters.get("mar")?.enabled, false);
  assert.equal(studioControls.characters.get("mar")?.enabled, true);

  const key = crypto.randomUUID();
  const primaryRun = await reserveDryRun(ownerId, "mar", key, 1, "primary");
  const studioRun = await reserveDryRun(ownerId, "mar", key, 1, "studio");
  assert.equal(primaryRun.kind, "created");
  assert.equal(studioRun.kind, "created");
  const primaryDuplicate = await reserveDryRun(ownerId, "mar", key, 1, "primary");
  assert.equal(primaryDuplicate.kind, "duplicate");
  assert.equal(primaryDuplicate.runId, primaryRun.kind === "created" ? primaryRun.runId : null);

  if (primaryRun.kind !== "created" || studioRun.kind !== "created") {
    throw new Error("SYNTHETIC_UNIVERSE_RUN_RESERVATION_FAILED");
  }
  await completeDryRun(ownerId, primaryRun.runId, {
    status: "executed", action: "like", situation: "like_post", sourceRevision: 1,
  }, "primary");
  await completeDryRun(ownerId, studioRun.runId, {
    status: "executed", action: "react", situation: "story_reaction", sourceRevision: 1,
  }, "studio");
  const since = new Date(NOW.getTime() - 24 * 60 * 60_000);
  const primaryHistory = await getExecutedActionHistory(ownerId, "mar", since, "primary");
  const studioHistory = await getExecutedActionHistory(ownerId, "mar", since, "studio");
  assert.deepEqual(primaryHistory.map((item) => item.situation), ["like_post"]);
  assert.deepEqual(studioHistory.map((item) => item.situation), ["story_reaction"]);

  const eligible = (await listLiveOptInTargets()).filter((target) => target.ownerId === ownerId);
  assert.deepEqual(eligible, [{ ownerId, universeId: "studio", characterId: "mar" }]);
});

test("live executor commits one synthetic post and treats a retry as a duplicate", async () => {
  const ownerId = syntheticOwnerId();
  const now = new Date();
  const { mar, runId } = await setupExecutorOwner({ ownerId, now });
  assert.equal(AUTONOMY_LIVE_EXECUTION_ENABLED, false);
  assert.equal(DEFAULT_CHARACTER_CONTROL.enabled, false);

  const input = {
    ownerId, runId, characterId: mar.id, sourceRevision: 1,
    opportunity: postOpportunity, decision: postDecision(), liveEnabled: true, now,
  };
  const first = await executeAutonomyDecision(input);
  assert.equal(first.status, "executed");
  if (first.status !== "executed") return;
  assert.equal(first.revision, 2);

  const [savedUniverse] = await db.select().from(echoUniversesTable)
    .where(eq(echoUniversesTable.ownerId, ownerId)).limit(1);
  assert.equal(savedUniverse.revision, 2);
  const saved = SaveUniverseBody.safeParse({ state: savedUniverse.state, expectedRevision: savedUniverse.revision });
  assert.equal(saved.success, true);
  if (saved.success) {
    const posts = saved.data.state.posts.filter((post) => post.authorId === mar.id);
    assert.equal(posts.length, 1);
    assert.equal(posts[0]?.caption, "Ensayo y café.");
    assert.equal(posts[0]?.image, "");
  }

  const retry = await executeAutonomyDecision(input);
  assert.deepEqual(retry, { status: "duplicate", reasonCode: "ALREADY_EXECUTED" });
  const [run] = await db.select().from(echoAutonomyRunsTable)
    .where(eq(echoAutonomyRunsTable.id, Number(runId))).limit(1);
  assert.equal(run.status, "executed");
  assert.equal((await db.select().from(echoUniversesTable)
    .where(eq(echoUniversesTable.ownerId, ownerId)).limit(1))[0]?.revision, 2);
});

test("executor binds a run to its universe when a character exists in two universes", async () => {
  const ownerId = syntheticOwnerId();
  const now = new Date();
  const primary = await setupExecutorOwner({ ownerId, universeId: "primary", now });
  const studioState = fixture().state;
  await insertSyntheticUniverse(ownerId, studioState, now, 1, "studio");
  await updateCharacterControl(ownerId, primary.mar.id, true, "studio");
  const studioRunId = await insertAutonomyRun({ ownerId, universeId: "studio", now });
  const base = {
    ownerId,
    characterId: primary.mar.id,
    sourceRevision: 1,
    opportunity: postOpportunity,
    decision: postDecision("Studio rehearsal."),
    liveEnabled: true,
    now,
  } as const;

  const crossUniverseRun = await executeAutonomyDecision({
    ...base, universeId: "studio", runId: primary.runId,
  });
  assert.deepEqual(crossUniverseRun, { status: "blocked", reasonCode: "RUN_NOT_OWNED" });

  const studioExecution = await executeAutonomyDecision({
    ...base, universeId: "studio", runId: studioRunId,
  });
  assert.equal(studioExecution.status, "executed");

  const universes = await db.select({
    universeId: echoUniversesTable.universeId,
    revision: echoUniversesTable.revision,
    state: echoUniversesTable.state,
  }).from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId));
  const primaryAfter = universes.find((item) => item.universeId === "primary")!;
  const studioAfter = universes.find((item) => item.universeId === "studio")!;
  assert.equal(primaryAfter.revision, 1);
  assert.equal(studioAfter.revision, 2);
  assert.equal((primaryAfter.state as unknown as SocialState).posts.length, 0);
  assert.equal((studioAfter.state as unknown as SocialState).posts.length, 1);
});

test("executor rejects a decision after the universe revision changes without applying it", async () => {
  const ownerId = syntheticOwnerId();
  const now = new Date();
  const { state, mar, runId } = await setupExecutorOwner({ ownerId, now });
  const decisionMadeAgainstRevision = 1;
  const concurrentState: SocialState = structuredClone(state);
  concurrentState.characters.find((character) => character.id === mar.id)!.bio = "Concurrent synthetic edit";
  await db.update(echoUniversesTable).set({
    state: concurrentState as unknown as Record<string, unknown>,
    revision: 2,
    updatedAt: now,
  }).where(eq(echoUniversesTable.ownerId, ownerId));

  const stale = await executeAutonomyDecision({
    ownerId, runId, characterId: mar.id, sourceRevision: decisionMadeAgainstRevision,
    opportunity: postOpportunity, decision: postDecision(), liveEnabled: true, now,
  });
  assert.deepEqual(stale, { status: "stale_revision", reasonCode: "UNIVERSE_REVISION_CHANGED" });

  const [universe] = await db.select().from(echoUniversesTable)
    .where(eq(echoUniversesTable.ownerId, ownerId)).limit(1);
  assert.equal(universe.revision, 2);
  const parsed = SaveUniverseBody.safeParse({ state: universe.state, expectedRevision: universe.revision });
  assert.equal(parsed.success, true);
  if (parsed.success) {
    assert.equal(parsed.data.state.characters.find((character) => character.id === mar.id)?.bio, "Concurrent synthetic edit");
    assert.equal(parsed.data.state.posts.length, 0);
  }
  const [run] = await db.select().from(echoAutonomyRunsTable)
    .where(eq(echoAutonomyRunsTable.id, Number(runId))).limit(1);
  assert.equal(run.status, "stale_revision");
  assert.equal(run.lastErrorCode, "UNIVERSE_REVISION_CHANGED");
  assert.equal(run.finishedAt instanceof Date, true);
});

test("executor defaults, kill switch, opt-in, and owner scoping block synthetic writes", async () => {
  assert.equal(AUTONOMY_LIVE_EXECUTION_ENABLED, false);
  assert.equal(DEFAULT_CHARACTER_CONTROL.enabled, false);

  const defaultOwner = syntheticOwnerId();
  const defaultControls = await readOwnerControls(defaultOwner);
  assert.equal(defaultControls.globalKillSwitchEngaged, true);
  assert.equal(defaultControls.characters.get("mar"), undefined);
  const defaultResult = await executeAutonomyDecision({
    ownerId: defaultOwner, runId: "0", characterId: "mar", sourceRevision: 1,
    opportunity: postOpportunity, decision: postDecision(), now: new Date(),
  });
  assert.equal(defaultResult.status, "disabled");
  assert.equal(defaultResult.reasonCode, "LIVE_EXECUTION_DISABLED");

  for (const scenario of [
    { killSwitchEngaged: true, characterEnabled: true },
    { killSwitchEngaged: false, characterEnabled: false },
  ]) {
    const ownerId = syntheticOwnerId();
    const now = new Date();
    const { runId } = await setupExecutorOwner({ ownerId, now, ...scenario });
    const result = await executeAutonomyDecision({
      ownerId, runId, characterId: "mar", sourceRevision: 1,
      opportunity: postOpportunity, decision: postDecision(), liveEnabled: true, now,
    });
    assert.equal(result.status, "disabled");
    assert.equal(result.reasonCode, "OPT_IN_OR_KILL_SWITCH");
    const [universe] = await db.select().from(echoUniversesTable)
      .where(eq(echoUniversesTable.ownerId, ownerId)).limit(1);
    assert.equal(universe.revision, 1);
    const parsed = SaveUniverseBody.safeParse({ state: universe.state, expectedRevision: universe.revision });
    assert.equal(parsed.success, true);
    if (parsed.success) assert.equal(parsed.data.state.posts.length, 0);
  }

  const ownerA = syntheticOwnerId();
  const ownerB = syntheticOwnerId();
  const now = new Date();
  await setupExecutorOwner({ ownerId: ownerA, now });
  const { runId: foreignRunId } = await setupExecutorOwner({ ownerId: ownerB, now });
  const foreignRun = await executeAutonomyDecision({
    ownerId: ownerA, runId: foreignRunId, characterId: "mar", sourceRevision: 1,
    opportunity: postOpportunity, decision: postDecision(), liveEnabled: true, now,
  });
  assert.deepEqual(foreignRun, { status: "blocked", reasonCode: "RUN_NOT_OWNED" });
  const [unchanged] = await db.select().from(echoUniversesTable)
    .where(eq(echoUniversesTable.ownerId, ownerA)).limit(1);
  assert.equal(unchanged.revision, 1);
});

test("executor enforces character cooldown, daily cap, and action-type cap in its transaction", async () => {
  const now = new Date();
  const cooldownOwner = syntheticOwnerId();
  const { state, mar } = fixture();
  const oldDraft = applyAutonomyDecision(
    state, mar.id, postOpportunity, postDecision(), new Date(now.getTime() - 30 * 60_000), () => "manual-post",
  );
  const cooldownState = {
    ...oldDraft.state,
    posts: oldDraft.state.posts.map((post) => ({ ...post, origin: "user" as const })),
  };
  const cooldownFixture = await setupExecutorOwner({
    ownerId: cooldownOwner, now, state: cooldownState, minCooldownMinutes: 60, maxActionsPerDay: 2,
  });
  const cooldown = await executeAutonomyDecision({
    ownerId: cooldownOwner, runId: cooldownFixture.runId, characterId: mar.id, sourceRevision: 1,
    opportunity: postOpportunity, decision: postDecision(), liveEnabled: true, now,
  });
  assert.equal(cooldown.status, "rate_limited");
  assert.equal(cooldown.reasonCode, "CHARACTER_COOLDOWN_OR_DAILY_CAP");

  for (const scenario of [
    { cap: 1, expected: "CHARACTER_COOLDOWN_OR_DAILY_CAP" },
    { cap: 4, expected: "ACTION_TYPE_CAP" },
  ]) {
    const ownerId = syntheticOwnerId();
    const fixtureForCap = await setupExecutorOwner({
      ownerId, now, maxActionsPerDay: scenario.cap, minCooldownMinutes: 60,
    });
    await insertAutonomyRun({
      ownerId, characterId: "mar", status: "executed", action: "draft", situation: "post",
      now: new Date(now.getTime() - 2 * 60 * 60_000),
    });
    const capped = await executeAutonomyDecision({
      ownerId, runId: fixtureForCap.runId, characterId: "mar", sourceRevision: 1,
      opportunity: postOpportunity, decision: postDecision(), liveEnabled: true, now,
    });
    assert.equal(capped.status, "rate_limited");
    assert.equal(capped.reasonCode, scenario.expected);
    const [universe] = await db.select().from(echoUniversesTable)
      .where(eq(echoUniversesTable.ownerId, ownerId)).limit(1);
    assert.equal(universe.revision, 1);
  }
});

test("opt-in target query returns only enabled characters whose owner kill switch is off", async () => {
  const eligibleOwner = syntheticOwnerId();
  const killedOwner = syntheticOwnerId();
  const optedOutOwner = syntheticOwnerId();
  await updateOwnerKillSwitch(eligibleOwner, false);
  await updateCharacterControl(eligibleOwner, "mar", true);
  await updateOwnerKillSwitch(killedOwner, true);
  await updateCharacterControl(killedOwner, "mar", true);
  await updateOwnerKillSwitch(optedOutOwner, false);
  await updateCharacterControl(optedOutOwner, "mar", false);

  const targets = await listLiveOptInTargets();
  const ownTargets = targets.filter(({ ownerId }) =>
    [eligibleOwner, killedOwner, optedOutOwner].includes(ownerId),
  );
  assert.deepEqual(ownTargets, [{ ownerId: eligibleOwner, universeId: "primary", characterId: "mar" }]);
});

test("worker tick gates disabled and busy states before target selection", async () => {
  let listed = 0;
  let processed = 0;
  let claimed = 0;
  const repository = {
    listLiveOptInTargets: async () => { listed += 1; return [{ ownerId: "synthetic", universeId: "primary", characterId: "mar" }]; },
    claimWorkerLease: async () => { claimed += 1; return false; },
    releaseWorkerLease: async () => undefined,
  };
  const processCharacter = async () => { processed += 1; return { status: "executed" }; };

  const disabled = await runAutonomyWorkerTick({ enabled: false, repository, processCharacter });
  assert.equal(disabled.status, "disabled");
  assert.equal(claimed, 0);
  assert.equal(listed, 0);

  const busy = await runAutonomyWorkerTick({ enabled: true, repository, processCharacter });
  assert.equal(busy.status, "busy");
  assert.equal(claimed, 1);
  assert.equal(listed, 0);
  assert.equal(processed, 0);
});

test("worker tick uses deterministic per-slot keys, continues after a target failure, and releases its lease", async () => {
  const now = new Date("2026-11-03T12:00:00.000Z");
  const targets = [
    { ownerId: "synthetic-owner-a", universeId: "primary", characterId: "mar" },
    { ownerId: "synthetic-owner-b", universeId: "studio", characterId: "noah" },
    { ownerId: "synthetic-owner-c", universeId: "primary", characterId: "felix" },
  ];
  const seenKeys: string[] = [];
  const released: string[] = [];
  let claimCount = 0;
  const repository = {
    listLiveOptInTargets: async () => targets,
    claimWorkerLease: async (token: string, _at: Date, ttl: number) => {
      claimCount += 1;
      assert.equal(token, "synthetic-worker-token");
      assert.equal(ttl, 10 * 60_000);
      return true;
    },
    releaseWorkerLease: async (token: string) => { released.push(token); },
  };
  const processCharacter = async (_ownerId: string, input: { universeId: string; characterId: string; idempotencyKey: string }) => {
    seenKeys.push(`${input.universeId}:${input.characterId}:${input.idempotencyKey}`);
    if (input.characterId === "mar") return { status: "executed" };
    if (input.characterId === "noah") return { status: "no_action" };
    throw new Error("SYNTHETIC_TARGET_FAILURE");
  };
  const first = await runAutonomyWorkerTick({
    enabled: true, repository, processCharacter, now, tokenFactory: () => "synthetic-worker-token",
  });
  assert.deepEqual(first, { status: "completed", evaluated: 3, executed: 1, noAction: 1, failed: 1 });
  const firstKeys = [...seenKeys];
  assert.equal(firstKeys.length, 3);
  assert.ok(firstKeys.every((entry) => /^.+:.+:worker:\d+:[a-f0-9]{24}$/.test(entry)));
  assert.deepEqual(released, ["synthetic-worker-token"]);

  seenKeys.length = 0;
  const second = await runAutonomyWorkerTick({
    enabled: true, repository, processCharacter, now, tokenFactory: () => "synthetic-worker-token",
  });
  assert.equal(second.status, "completed");
  assert.deepEqual(seenKeys, firstKeys);
  assert.equal(claimCount, 2);
  assert.deepEqual(released, ["synthetic-worker-token", "synthetic-worker-token"]);
});

test("background scheduler is wired but globally disabled; timer lifecycle is controllable in tests", () => {
  assert.equal(AUTONOMY_LIVE_EXECUTION_ENABLED, false);
  const actualStartup = startAutonomyBackgroundWorker();
  assert.equal(actualStartup.started, false);
  actualStartup.stop();

  let scheduled = 0;
  let cleared = 0;
  let interval = 0;
  const fakeTimer = { unref() {} } as unknown as ReturnType<typeof setInterval>;
  const stopped = startAutonomyWorker({
    enabled: false,
    tick: async () => ({ status: "disabled", evaluated: 0, executed: 0, noAction: 0, failed: 0 }),
    setIntervalFn: (() => { scheduled += 1; return fakeTimer; }) as unknown as typeof setInterval,
    clearIntervalFn: (() => { cleared += 1; }) as typeof clearInterval,
  });
  assert.equal(stopped.started, false);
  assert.equal(scheduled, 0);

  const started = startAutonomyWorker({
    enabled: true,
    intervalMs: AUTONOMY_WORKER_INTERVAL_MS,
    tick: async () => ({ status: "completed", evaluated: 0, executed: 0, noAction: 0, failed: 0 }),
    setIntervalFn: ((_callback: (...args: unknown[]) => void, delay?: number) => {
      scheduled += 1;
      interval = delay ?? 0;
      return fakeTimer;
    }) as typeof setInterval,
    clearIntervalFn: ((_timer: ReturnType<typeof setInterval>) => { cleared += 1; }) as typeof clearInterval,
  });
  assert.equal(started.started, true);
  assert.equal(scheduled, 1);
  assert.equal(interval, AUTONOMY_WORKER_INTERVAL_MS);
  started.stop();
  assert.equal(cleared, 1);
});

test("PostgreSQL worker lease is exclusive, token-owned, and restores the prior singleton row", async () => {
  const name = "autonomy-live-worker";
  const [previous] = await db.select().from(echoAutonomyWorkerLeasesTable)
    .where(eq(echoAutonomyWorkerLeasesTable.name, name)).limit(1);
  const now = new Date();
  const expired = new Date(now.getTime() - 1_000);
  const firstToken = `synthetic-lease-${crypto.randomUUID()}`;
  const secondToken = `synthetic-lease-${crypto.randomUUID()}`;
  try {
    await db.insert(echoAutonomyWorkerLeasesTable).values({
      name, token: "synthetic-expired-lease", expiresAt: expired, updatedAt: expired,
    }).onConflictDoUpdate({
      target: echoAutonomyWorkerLeasesTable.name,
      set: { token: "synthetic-expired-lease", expiresAt: expired, updatedAt: expired },
    });
    assert.equal(await claimAutonomyWorkerLease(firstToken, now, 60_000), true);
    assert.equal(await claimAutonomyWorkerLease(secondToken, now, 60_000), false);
    await releaseAutonomyWorkerLease(secondToken);
    const [stillOwned] = await db.select().from(echoAutonomyWorkerLeasesTable)
      .where(eq(echoAutonomyWorkerLeasesTable.name, name)).limit(1);
    assert.equal(stillOwned.token, firstToken);
    await releaseAutonomyWorkerLease(firstToken);
    assert.equal((await db.select().from(echoAutonomyWorkerLeasesTable)
      .where(eq(echoAutonomyWorkerLeasesTable.name, name)).limit(1)).length, 0);
  } finally {
    if (previous) {
      await db.insert(echoAutonomyWorkerLeasesTable).values(previous).onConflictDoUpdate({
        target: echoAutonomyWorkerLeasesTable.name,
        set: { token: previous.token, expiresAt: previous.expiresAt, updatedAt: previous.updatedAt },
      });
    } else {
      await db.delete(echoAutonomyWorkerLeasesTable)
        .where(eq(echoAutonomyWorkerLeasesTable.name, name));
    }
  }
});

test("live cycle recovers stuck runs only after the current threshold and attempt limit, without social execution", async () => {
  assert.equal(AUTONOMY_LIVE_EXECUTION_ENABLED, false);
  const ownerId = syntheticOwnerId();
  const { state, mar } = fixture();
  const now = new Date();
  const provider: TextProvider = {
    name: "synthetic-no-call",
    complete: async () => { throw new Error("PROVIDER_MUST_NOT_BE_CALLED"); },
  };
  let providerCalls = 0;
  let executorCalls = 0;
  const repository = {
    read: async () => ({ state, revision: 1 }),
    readControls: async () => ({
      globalKillSwitchEngaged: false,
      liveExecutionEnabled: true,
      characters: new Map([[mar.id, { enabled: true, maxActionsPerDay: 1, minCooldownMinutes: 60 }]]),
    }),
    getExecutedHistory: async () => [{
      status: "executed", action: "draft", situation: "post",
      createdAt: new Date(now.getTime() - 60_000),
    }],
    reserve: reserveDryRun,
    complete: completeDryRun,
    executeDecision: async () => {
      executorCalls += 1;
      return { status: "executed", action: "draft", situation: "post", targetId: "must-not-exist", revision: 2 } as const;
    },
  };
  const run = async (key: string) => runAutonomyLiveCycle(ownerId, {
    characterId: mar.id, idempotencyKey: key,
  }, {
    repository,
    provider: {
      ...provider,
      complete: async () => { providerCalls += 1; throw new Error("PROVIDER_MUST_NOT_BE_CALLED"); },
    },
    liveExecutionEnabled: true,
    now,
    random: () => 0,
  });
  const inspectRun = async (idempotencyKey: string) => {
    const [row] = await db.select().from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, ownerId),
      eq(echoAutonomyRunsTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    return row;
  };

  const recentKey = crypto.randomUUID();
  await insertAutonomyRun({
    ownerId, key: recentKey, status: "running", attemptCount: 1,
    now, updatedAt: new Date(Date.now() - 110_000),
  });
  const recent = await run(recentKey);
  assert.equal(recent.status, "in_progress");
  assert.equal((await inspectRun(recentKey)).attemptCount, 1);

  const staleKey = crypto.randomUUID();
  await insertAutonomyRun({
    ownerId, key: staleKey, status: "running", attemptCount: 1,
    now, updatedAt: new Date(Date.now() - 130_000),
  });
  const reclaimed = await run(staleKey);
  assert.equal(reclaimed.status, "cooldown");
  const reclaimedRow = await inspectRun(staleKey);
  assert.equal(reclaimedRow.attemptCount, 2);
  assert.equal(reclaimedRow.status, "cooldown");
  assert.equal(reclaimedRow.finishedAt instanceof Date, true);

  const exhaustedKey = crypto.randomUUID();
  await insertAutonomyRun({
    ownerId, key: exhaustedKey, status: "running", attemptCount: 3,
    now, updatedAt: new Date(Date.now() - 130_000),
  });
  const exhausted = await run(exhaustedKey);
  assert.equal(exhausted.status, "duplicate");
  const exhaustedRow = await inspectRun(exhaustedKey);
  assert.equal(exhaustedRow.status, "stale_failed");
  assert.equal(exhaustedRow.lastErrorCode, "LEASE_EXPIRED");
  assert.equal(exhaustedRow.finishedAt instanceof Date, true);
  assert.equal(providerCalls, 0);
  assert.equal(executorCalls, 0);
  assert.equal(state.posts.length, 0);
});
