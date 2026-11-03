import test from "node:test";
import { after } from "node:test";
import assert from "node:assert/strict";
import { inArray } from "drizzle-orm";
import {
  db,
  pool,
  echoAutonomyCharactersTable,
  echoAutonomyOwnersTable,
  echoAutonomyRunsTable,
} from "@workspace/db";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { chooseAutonomyOpportunity, liveEligibility } from "../src/autonomy/policy";
import { runAutonomyDryRun } from "../src/autonomy/service";
import { buildCharacterContext } from "../src/ai-engine/context";
import { previewDecision } from "../src/ai-engine/engine";
import type { AutonomyRepository } from "../src/autonomy/service";
import type { TextProvider } from "../src/ai-engine/contracts";
import {
  readOwnerControls,
  reserveDryRun,
  updateCharacterControl,
  updateOwnerKillSwitch,
} from "../src/autonomy/repository";

const NOW = new Date("2026-11-03T12:00:00.000Z");
const dbOwners = [`autonomy-synthetic-${crypto.randomUUID()}`, `autonomy-synthetic-${crypto.randomUUID()}`];
after(async () => {
  await db.delete(echoAutonomyRunsTable).where(inArray(echoAutonomyRunsTable.ownerId, dbOwners));
  await db.delete(echoAutonomyCharactersTable).where(inArray(echoAutonomyCharactersTable.ownerId, dbOwners));
  await db.delete(echoAutonomyOwnersTable).where(inArray(echoAutonomyOwnersTable.ownerId, dbOwners));
  await pool.end();
});

function fixture() {
  const state = createSeedState();
  state.posts = [];
  state.comments = [];
  state.stories = [];
  state.messages = [];
  const mar = state.characters.find((character) => character.id === "mar")!;
  mar.configuration = defaultCharacterConfig(mar);
  mar.configuration.social.activity = "high";
  mar.configuration.social.sociability = "high";
  mar.configuration.social.spontaneity = "high";
  mar.configuration.social.allowSilence = false;
  mar.configuration.currentState.lastActivityAt = null;
  return { state, mar };
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

test("planner considers non-repeating post/comment likes and text-based story/DM reactions", () => {
  const postFixture = fixture();
  const noah = postFixture.state.characters.find((character) => character.id === "noah")!;
  addNoahRelationship(postFixture.mar, noah.id);
  postFixture.state.posts.push({
    id: "likeable-post", authorId: noah.id, caption: "Ensayo hasta tarde", location: "",
    createdAt: new Date(NOW.getTime() - 60 * 60_000), likes: [], savedBy: [], commentsEnabled: true,
  } as (typeof postFixture.state.posts)[number]);
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
  } as (typeof commentFixture.state.posts)[number]);
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
  } as (typeof state.posts)[number]);
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
  } as (typeof state.posts)[number]);
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
    date: "2026-11-02", flexibility: "flexible",
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
  let providerCalls = 0;
  let reserves = 0;
  const repository: AutonomyRepository = {
    read: async (ownerId) => ownerId === "owner-a"
      ? { state, revision: 7 }
      : { state: null, revision: 0 },
    readControls: async (ownerId) => ({
      globalKillSwitchEngaged: false,
      liveExecutionEnabled: false,
      characters: new Map(ownerId === "owner-a" ? [[mar.id, {
        enabled: true, maxActionsPerDay: 2, minCooldownMinutes: 360,
      }]] : []),
    }),
    getExecutedHistory: async () => [],
    reserve: async (ownerId, _characterId, key) => {
      reserves += 1;
      const ledgerKey = `${ownerId}:${key}`;
      const previous = ledger.get(ledgerKey);
      if (previous) return { kind: "duplicate" as const, runId: previous.id, status: previous.status, characterId: "mar" };
      const run = { id: String(ledger.size + 1), status: "running" };
      ledger.set(ledgerKey, run);
      return { kind: "created" as const, runId: run.id };
    },
    complete: async (_ownerId, runId, result) => {
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
  const input = { characterId: "mar", idempotencyKey: "00000000-0000-4000-8000-000000000001" };
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
