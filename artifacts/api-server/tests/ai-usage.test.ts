import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray } from "drizzle-orm";
import {
  db,
  pool,
  echoAiUsageEventsTable,
  echoCreatorEntitlementsTable,
} from "@workspace/db";
import type { TextProvider } from "../src/ai-engine/contracts";
import { MeteredTextProvider } from "../src/lib/metered-ai";
import {
  AiBudgetExceededError,
  configureAiBudget,
  creatorUsageSummary,
  DEFAULT_AI_CATEGORY_WEIGHTS,
  DEFAULT_MONTHLY_HARD_CEILING_UNITS,
  reserveAiUsage,
  settleAiUsage,
} from "../src/lib/ai-usage";

const fixtureOwners: string[] = [];
const currentMonth = (() => {
  const now = new Date();
  return `${now.getUTCFullYear()}-${String(now.getUTCMonth() + 1).padStart(2, "0")}`;
})();

function ownerId() {
  const id = `ai-budget-synthetic-${randomUUID()}`;
  fixtureOwners.push(id);
  return id;
}

function weights(overrides: Partial<typeof DEFAULT_AI_CATEGORY_WEIGHTS> = {}) {
  return { ...DEFAULT_AI_CATEGORY_WEIGHTS, ...overrides };
}

async function configure(ownerId: string, ceiling: number, reserve = 20, categoryWeights = weights()) {
  return configureAiBudget(ownerId, {
    monthlyHardCeilingUnits: ceiling,
    autonomyReservePercent: reserve,
    categoryWeights,
  });
}

async function seedCharge(ownerId: string, category: "autonomy" | "brain_text" | "memory_context" | "vision" | "images", units: number) {
  await db.insert(echoAiUsageEventsTable).values({
    id: randomUUID(),
    ownerId,
    monthKey: currentMonth,
    category,
    operation: "synthetic_budget_fixture",
    status: "succeeded",
    chargedUnits: units,
    reservedUnits: 0,
    attemptCount: 1,
  });
}

after(async () => {
  if (fixtureOwners.length) {
    await db.delete(echoAiUsageEventsTable).where(inArray(echoAiUsageEventsTable.ownerId, fixtureOwners));
    await db.delete(echoCreatorEntitlementsTable).where(inArray(echoCreatorEntitlementsTable.ownerId, fixtureOwners));
  }
  await pool.end();
});

test("uses a configurable non-null default and persists weighted reservations/charges", async () => {
  const owner = ownerId();
  await configure(owner, 40, 20, weights({ brain_text: 2 }));

  const [entitlement] = await db.select().from(echoCreatorEntitlementsTable)
    .where(eq(echoCreatorEntitlementsTable.ownerId, owner)).limit(1);
  assert.equal(entitlement.monthlyHardCeilingUnits, 40);
  assert.equal(typeof entitlement.monthlyHardCeilingUnits, "number");

  const reservation = await reserveAiUsage(owner, "brain_text", "synthetic_text");
  assert.equal(reservation.units, 2);
  const [reserved] = await db.select().from(echoAiUsageEventsTable)
    .where(eq(echoAiUsageEventsTable.id, reservation.id)).limit(1);
  assert.equal(reserved.status, "reserved");
  assert.equal(reserved.reservedUnits, 2);

  await settleAiUsage(reservation, { attempted: true, succeeded: true, attemptCount: 1 });
  const [settled] = await db.select().from(echoAiUsageEventsTable)
    .where(eq(echoAiUsageEventsTable.id, reservation.id)).limit(1);
  assert.equal(settled.status, "succeeded");
  assert.equal(settled.chargedUnits, 2);
  assert.equal(settled.reservedUnits, 0);

  const summary = await creatorUsageSummary(owner);
  assert.equal(summary.categories.brain_text.units, 2);
  assert.equal(summary.totalUnits, 2);
  assert.equal("monthlyHardCeilingUnits" in summary, false, "internal ceiling must not be exposed in customer usage summaries");
  assert.equal("autonomyReservePercent" in summary, false);
  assert.equal("categoryWeights" in summary, false);
  assert.equal(DEFAULT_MONTHLY_HARD_CEILING_UNITS, 500);
});

test("new owner entitlements persist the safe non-null default ceiling", async () => {
  const owner = ownerId();
  const reservation = await reserveAiUsage(owner, "brain_text", "synthetic_default");
  await settleAiUsage(reservation, { attempted: true, succeeded: true });

  const [entitlement] = await db.select().from(echoCreatorEntitlementsTable)
    .where(eq(echoCreatorEntitlementsTable.ownerId, owner)).limit(1);
  assert.equal(entitlement.monthlyHardCeilingUnits, DEFAULT_MONTHLY_HARD_CEILING_UNITS);
  assert.equal(entitlement.monthlyHardCeilingUnits, 500);
});

test("protects the non-autonomy reserve and stops Autonomy at its safe share", async () => {
  const owner = ownerId();
  await configure(owner, 100, 20, weights({ autonomy: 10, brain_text: 5 }));
  await seedCharge(owner, "autonomy", 70);

  const finalAllowedAutonomy = await reserveAiUsage(owner, "autonomy", "synthetic_autonomy");
  assert.equal(finalAllowedAutonomy.units, 10);
  await settleAiUsage(finalAllowedAutonomy, { attempted: true, succeeded: true });

  await assert.rejects(
    reserveAiUsage(owner, "autonomy", "synthetic_autonomy_over_reserve"),
    (error: unknown) => error instanceof AiBudgetExceededError && error.code === "AUTONOMY_BUDGET_PROTECTED",
  );

  // The units protected from Autonomy remain available to other categories.
  const protectedForOtherWork = await reserveAiUsage(owner, "brain_text", "synthetic_brain");
  assert.equal(protectedForOtherWork.units, 5);
  await settleAiUsage(protectedForOtherWork, { attempted: true, succeeded: true });
  const [blockedAutonomy] = await db.select().from(echoAiUsageEventsTable).where(and(
    eq(echoAiUsageEventsTable.ownerId, owner),
    eq(echoAiUsageEventsTable.operation, "synthetic_autonomy_over_reserve"),
  )).limit(1);
  assert.equal(blockedAutonomy.status, "blocked");
  assert.equal(blockedAutonomy.errorCode, "AUTONOMY_BUDGET_PROTECTED");
});

test("degrades an autonomy provider call before reaching the external provider", async () => {
  const owner = ownerId();
  await configure(owner, 100, 20, weights({ autonomy: 10 }));
  await seedCharge(owner, "autonomy", 80);

  let externalCalls = 0;
  const inner = {
    name: "synthetic-provider",
    complete: async () => {
      externalCalls += 1;
      return { text: "must not be called" };
    },
  } as unknown as TextProvider;
  const provider = new MeteredTextProvider(owner, "autonomy", inner);

  await assert.rejects(
    provider.complete({} as Parameters<TextProvider["complete"]>[0]),
    (error: unknown) => error instanceof Error && error.message === "AUTONOMY_BUDGET_PROTECTED",
  );
  assert.equal(externalCalls, 0);
});

test("blocks all categories after the hard ceiling is exhausted", async () => {
  const owner = ownerId();
  await configure(owner, 10, 20, weights({ brain_text: 2, vision: 5 }));
  await seedCharge(owner, "brain_text", 10);

  await assert.rejects(
    reserveAiUsage(owner, "vision", "synthetic_after_exhaustion"),
    (error: unknown) => error instanceof AiBudgetExceededError && error.code === "AI_MONTHLY_HARD_CEILING",
  );
  const summary = await creatorUsageSummary(owner);
  assert.equal(summary.totalUnits, 10);
});

test("structural add-ons do not increase the AI usage pool", async () => {
  const owner = ownerId();
  await configure(owner, 10, 20, weights({ brain_text: 2 }));
  await db.update(echoCreatorEntitlementsTable).set({
    addonCharacters: 100,
    addonUniverses: 100,
  }).where(eq(echoCreatorEntitlementsTable.ownerId, owner));
  await seedCharge(owner, "brain_text", 10);

  await assert.rejects(
    reserveAiUsage(owner, "brain_text", "synthetic_addon_no_ai_pool"),
    (error: unknown) => error instanceof AiBudgetExceededError && error.code === "AI_MONTHLY_HARD_CEILING",
  );
  const [entitlement] = await db.select({
    addonCharacters: echoCreatorEntitlementsTable.addonCharacters,
    addonUniverses: echoCreatorEntitlementsTable.addonUniverses,
    monthlyHardCeilingUnits: echoCreatorEntitlementsTable.monthlyHardCeilingUnits,
  }).from(echoCreatorEntitlementsTable).where(eq(echoCreatorEntitlementsTable.ownerId, owner)).limit(1);
  assert.deepEqual(entitlement, { addonCharacters: 100, addonUniverses: 100, monthlyHardCeilingUnits: 10 });
});

test("rejects configuration that would remove the ceiling or Autonomy reserve", async () => {
  const owner = ownerId();
  await assert.rejects(
    configureAiBudget(owner, {
      monthlyHardCeilingUnits: null as unknown as number,
      autonomyReservePercent: 20,
      categoryWeights: weights(),
    }),
    /INVALID_INTERNAL_AI_BUDGET_CONFIGURATION/,
  );
  await assert.rejects(
    configure(owner, 100, 0),
    /INVALID_INTERNAL_AI_BUDGET_CONFIGURATION/,
  );
});
