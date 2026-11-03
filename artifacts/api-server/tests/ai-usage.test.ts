import assert from "node:assert/strict";
import { after, test } from "node:test";
import { randomUUID } from "node:crypto";
import { and, eq, inArray, sql } from "drizzle-orm";
import {
  db,
  pool,
  echoAiUsageEventsTable,
  echoCreatorEntitlementsTable,
  echoUniversesTable,
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

async function seedCharge(
  ownerId: string,
  category: "autonomy" | "brain_text" | "memory_context" | "vision" | "images",
  units: number,
  operation = "synthetic_budget_fixture",
) {
  await db.insert(echoAiUsageEventsTable).values({
    id: randomUUID(),
    ownerId,
    monthKey: currentMonth,
    category,
    operation,
    status: "succeeded",
    chargedUnits: units,
    reservedUnits: 0,
    attemptCount: 1,
  });
}

after(async () => {
  if (fixtureOwners.length) {
    await db.delete(echoAiUsageEventsTable).where(inArray(echoAiUsageEventsTable.ownerId, fixtureOwners));
    await db.delete(echoUniversesTable).where(inArray(echoUniversesTable.ownerId, fixtureOwners));
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

test("protects Autonomy's reserve across two universes and keeps one owner-wide pool", async () => {
  const owner = ownerId();
  await configure(owner, 100, 20, weights({ autonomy: 10, brain_text: 5 }));
  await db.insert(echoUniversesTable).values([
    { ownerId: owner, universeId: "budget-universe-a", state: { characters: [] }, revision: 1 },
    { ownerId: owner, universeId: "budget-universe-b", state: { characters: [] }, revision: 1 },
  ]);
  await seedCharge(owner, "brain_text", 80, "synthetic_universe_a");

  const [universeCount] = await db.select({ count: sql<number>`count(*)` })
    .from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, owner));
  assert.equal(Number(universeCount.count), 2);
  const [entitlementCount] = await db.select({ count: sql<number>`count(*)` })
    .from(echoCreatorEntitlementsTable).where(eq(echoCreatorEntitlementsTable.ownerId, owner));
  assert.equal(Number(entitlementCount.count), 1);

  // Heavy use in universe A cannot consume the Autonomy share before work in B.
  await assert.rejects(
    reserveAiUsage(owner, "brain_text", "synthetic_universe_b"),
    (error: unknown) => error instanceof AiBudgetExceededError && error.code === "AUTONOMY_BUDGET_RESERVED",
  );
  let rejectedProviderCalls = 0;
  const protectedBrainProvider = new MeteredTextProvider(owner, "brain_text", {
    name: "synthetic-protected-brain",
    complete: async () => {
      rejectedProviderCalls += 1;
      return { text: "must not be called" };
    },
  } as unknown as TextProvider);
  await assert.rejects(
    protectedBrainProvider.complete({} as Parameters<TextProvider["complete"]>[0]),
    (error: unknown) => error instanceof Error && error.message === "AUTONOMY_BUDGET_RESERVED",
  );
  assert.equal(rejectedProviderCalls, 0);

  // Autonomy can spend its protected 20-unit share after other categories reach 80.
  const firstReservedAutonomy = await reserveAiUsage(owner, "autonomy", "synthetic_autonomy_reserved_1");
  const secondReservedAutonomy = await reserveAiUsage(owner, "autonomy", "synthetic_autonomy_reserved_2");
  await settleAiUsage(firstReservedAutonomy, { attempted: true, succeeded: true });
  await settleAiUsage(secondReservedAutonomy, { attempted: true, succeeded: true });
  const [totals] = await db.select({
    charged: sql<number>`coalesce(sum(${echoAiUsageEventsTable.chargedUnits}), 0)`,
    reserved: sql<number>`coalesce(sum(${echoAiUsageEventsTable.reservedUnits}), 0)`,
  }).from(echoAiUsageEventsTable).where(eq(echoAiUsageEventsTable.ownerId, owner));
  assert.equal(Number(totals.charged) + Number(totals.reserved), 100);

  await assert.rejects(
    reserveAiUsage(owner, "autonomy", "synthetic_over_total_ceiling"),
    (error: unknown) => error instanceof AiBudgetExceededError && error.code === "AI_MONTHLY_HARD_CEILING",
  );
  const [blockedNonAutonomy] = await db.select().from(echoAiUsageEventsTable).where(and(
    eq(echoAiUsageEventsTable.ownerId, owner),
    eq(echoAiUsageEventsTable.operation, "synthetic_universe_b"),
  )).limit(1);
  assert.equal(blockedNonAutonomy.status, "blocked");
  assert.equal(blockedNonAutonomy.errorCode, "AUTONOMY_BUDGET_RESERVED");
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

test("Autonomy's individual cap leaves room for other categories, and budget blocks happen pre-provider", async () => {
  const autonomyOwner = ownerId();
  await configure(autonomyOwner, 100, 20, weights({ autonomy: 10 }));
  await seedCharge(autonomyOwner, "autonomy", 80);
  let autonomyExternalCalls = 0;
  const autonomyProvider = new MeteredTextProvider(autonomyOwner, "autonomy", {
    name: "synthetic-autonomy-provider",
    complete: async () => {
      autonomyExternalCalls += 1;
      return { text: "must not be called" };
    },
  } as unknown as TextProvider);
  await assert.rejects(
    autonomyProvider.complete({} as Parameters<TextProvider["complete"]>[0]),
    (error: unknown) => error instanceof Error && error.message === "AUTONOMY_BUDGET_PROTECTED",
  );
  assert.equal(autonomyExternalCalls, 0);

  const fullOwner = ownerId();
  await configure(fullOwner, 100, 20, weights({ brain_text: 10 }));
  await seedCharge(fullOwner, "brain_text", 100);
  let otherExternalCalls = 0;
  const otherProvider = new MeteredTextProvider(fullOwner, "brain_text", {
    name: "synthetic-brain-provider",
    complete: async () => {
      otherExternalCalls += 1;
      return { text: "must not be called" };
    },
  } as unknown as TextProvider);
  await assert.rejects(
    otherProvider.complete({} as Parameters<TextProvider["complete"]>[0]),
    (error: unknown) => error instanceof Error && error.message === "AI_MONTHLY_HARD_CEILING",
  );
  assert.equal(otherExternalCalls, 0);
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
