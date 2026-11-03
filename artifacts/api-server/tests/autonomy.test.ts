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

test("planner chooses silence before spending a model call", () => {
  const { state, mar } = fixture();
  const result = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0.99 });
  assert.equal(result.situation, null);
  assert.equal(result.reasonCode, "SILENCE_SELECTED");
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
  const reply = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: () => 0.5 });
  assert.equal(reply.situation, "comment");
  assert.equal(reply.postId, "unanswered-post");
  assert.equal(reply.commentId, "replyable-comment");
  const built = buildCharacterContext(state, {
    characterId: mar.id, situation: "comment", postId: reply.postId!, commentId: reply.commentId!,
  }, NOW);
  const context = JSON.parse(built.serialized) as { target: { replyTo: { text: string } } };
  assert.equal(context.target.replyTo.text, "¿Ensayo esta semana?");
  const dm = chooseAutonomyOpportunity({ state, character: mar, history: [], now: NOW, random: (() => {
    const values = [0, 0.99]; return () => values.shift() ?? 0.99;
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
  const [stale] = await db.insert(echoAutonomyRunsTable).values({
    ownerId: ownerB,
    characterId: "mar",
    idempotencyKey: staleKey,
    status: "running",
    sourceRevision: 1,
    createdAt: new Date(Date.now() - 5 * 60_000),
  }).returning({ id: echoAutonomyRunsTable.id });
  const recovered = await reserveDryRun(ownerB, "mar", staleKey, 2);
  assert.equal(recovered.kind, "created");
  assert.equal(recovered.runId, String(stale.id));

  const otherOwner = await reserveDryRun(ownerB, "nela", key, 1);
  assert.equal(otherOwner.kind, "created");
});
