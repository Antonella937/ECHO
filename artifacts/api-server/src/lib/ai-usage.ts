import { and, eq, sql } from "drizzle-orm";
import { randomUUID } from "node:crypto";
import {
  db,
  echoAiUsageEventsTable,
  echoCreatorEntitlementsTable,
  echoUniversesTable,
  type AiUsageCategory,
  type CreatorPlan,
} from "@workspace/db";

export const DEFAULT_MONTHLY_HARD_CEILING_UNITS = 500;
export const MAX_MONTHLY_HARD_CEILING_UNITS = DEFAULT_MONTHLY_HARD_CEILING_UNITS;
export const MIN_AUTONOMY_RESERVE_PERCENT = 20;
export const MAX_AUTONOMY_RESERVE_PERCENT = 90;
const MAX_CATEGORY_WEIGHT = 10_000;

export const AI_USAGE_CATEGORIES: AiUsageCategory[] = [
  "autonomy", "brain_text", "memory_context", "vision", "images",
];
export const DEFAULT_AI_CATEGORY_WEIGHTS = {
  autonomy: 1, brain_text: 1, memory_context: 1, vision: 5, images: 10,
} satisfies Record<AiUsageCategory, number>;

export class AiBudgetExceededError extends Error {
  constructor(readonly code: "AI_MONTHLY_HARD_CEILING" | "AUTONOMY_BUDGET_PROTECTED") { super(code); }
}

export interface UsageReservation {
  id: string;
  ownerId: string;
  category: AiUsageCategory;
  units: number;
}

function monthKey(at = new Date()) {
  return `${at.getUTCFullYear()}-${String(at.getUTCMonth() + 1).padStart(2, "0")}`;
}
function validPlan(value: unknown): CreatorPlan { return value === "creator" ? "creator" : "free"; }
function safeCategoryWeight(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) && value > 0
    ? Math.min(value, MAX_CATEGORY_WEIGHT)
    : 1;
}

async function ensureEntitlements(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ownerId: string) {
  const [primary] = await tx.select({ state: echoUniversesTable.state }).from(echoUniversesTable)
    .where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, "primary"))).limit(1);
  const setup = primary?.state?.creatorSetup as { plan?: unknown } | undefined;
  await tx.insert(echoCreatorEntitlementsTable).values({
    ownerId, plan: validPlan(setup?.plan),
  }).onConflictDoNothing();
  const [row] = await tx.select().from(echoCreatorEntitlementsTable)
    .where(eq(echoCreatorEntitlementsTable.ownerId, ownerId)).for("update").limit(1);
  if (!row) throw new Error("AI_ENTITLEMENTS_UNAVAILABLE");
  return row;
}

/**
 * Reserves weighted internal units before an external call. The ceiling is
 * always finite; Autonomy can use only the portion above the protected reserve.
 */
export async function reserveAiUsage(ownerId: string, category: AiUsageCategory, operation: string): Promise<UsageReservation> {
  const id = randomUUID();
  const outcome = await db.transaction(async (tx) => {
    const entitlements = await ensureEntitlements(tx, ownerId);
    const weight = safeCategoryWeight(entitlements.categoryWeights?.[category]);
    const month = monthKey();
    const [totals] = await tx.select({
      charged: sql<number>`coalesce(sum(${echoAiUsageEventsTable.chargedUnits}), 0)`,
      reserved: sql<number>`coalesce(sum(${echoAiUsageEventsTable.reservedUnits}), 0)`,
      autonomy: sql<number>`coalesce(sum(case when ${echoAiUsageEventsTable.category} = 'autonomy' then ${echoAiUsageEventsTable.chargedUnits} + ${echoAiUsageEventsTable.reservedUnits} else 0 end), 0)`,
    }).from(echoAiUsageEventsTable).where(and(
      eq(echoAiUsageEventsTable.ownerId, ownerId),
      eq(echoAiUsageEventsTable.monthKey, month),
    ));
    const used = Number(totals?.charged ?? 0) + Number(totals?.reserved ?? 0);
    const autonomyUsed = Number(totals?.autonomy ?? 0);
    const storedCeiling = entitlements.monthlyHardCeilingUnits;
    const ceiling = typeof storedCeiling === "number" && Number.isSafeInteger(storedCeiling) && storedCeiling > 0
      ? Math.min(storedCeiling, MAX_MONTHLY_HARD_CEILING_UNITS)
      : DEFAULT_MONTHLY_HARD_CEILING_UNITS;
    const storedReserve = entitlements.autonomyReservePercent;
    const autonomyReservePercent = typeof storedReserve === "number" && Number.isSafeInteger(storedReserve)
      ? Math.max(MIN_AUTONOMY_RESERVE_PERCENT, Math.min(MAX_AUTONOMY_RESERVE_PERCENT, storedReserve))
      : MIN_AUTONOMY_RESERVE_PERCENT;
    let blocked: AiBudgetExceededError["code"] | null = null;
    if (used + weight > ceiling) blocked = "AI_MONTHLY_HARD_CEILING";
    if (category === "autonomy") {
      const autonomousBudget = Math.floor(ceiling * (100 - autonomyReservePercent) / 100);
      if (autonomyUsed + weight > autonomousBudget) blocked = "AUTONOMY_BUDGET_PROTECTED";
    }
    await tx.insert(echoAiUsageEventsTable).values({
      id, ownerId, monthKey: month, category, operation,
      status: blocked ? "blocked" : "reserved",
      chargedUnits: 0, reservedUnits: blocked ? 0 : weight,
      attemptCount: 0, errorCode: blocked,
    });
    return blocked
      ? { reservation: null, blocked }
      : { reservation: { id, ownerId, category, units: weight }, blocked: null };
  });
  if (outcome.blocked) throw new AiBudgetExceededError(outcome.blocked);
  return outcome.reservation!;
}

export async function settleAiUsage(reservation: UsageReservation, result: {
  attempted: boolean;
  succeeded: boolean;
  attemptCount?: number;
  promptTokens?: number | null;
  completionTokens?: number | null;
  reportedCost?: number | null;
  provider?: string | null;
  model?: string | null;
  errorCode?: string | null;
}) {
  await db.update(echoAiUsageEventsTable).set({
    status: result.succeeded ? "succeeded" : "failed",
    chargedUnits: result.attempted ? reservation.units : 0,
    reservedUnits: 0,
    attemptCount: Math.max(0, Math.floor(result.attemptCount ?? (result.attempted ? 1 : 0))),
    promptTokens: result.promptTokens ?? null,
    completionTokens: result.completionTokens ?? null,
    reportedCost: result.reportedCost == null ? null : String(result.reportedCost),
    provider: result.provider ?? null,
    model: result.model ?? null,
    errorCode: result.errorCode ?? null,
    finishedAt: new Date(),
  }).where(and(
    eq(echoAiUsageEventsTable.id, reservation.id),
    eq(echoAiUsageEventsTable.ownerId, reservation.ownerId),
    eq(echoAiUsageEventsTable.status, "reserved"),
  ));
}

export async function creatorUsageSummary(ownerId: string) {
  const month = monthKey();
  const rows = await db.select({
    category: echoAiUsageEventsTable.category,
    calls: sql<number>`count(*)`,
    units: sql<number>`coalesce(sum(${echoAiUsageEventsTable.chargedUnits}), 0)`,
    promptTokens: sql<number>`coalesce(sum(${echoAiUsageEventsTable.promptTokens}), 0)`,
    completionTokens: sql<number>`coalesce(sum(${echoAiUsageEventsTable.completionTokens}), 0)`,
    reportedCost: sql<string | null>`sum(${echoAiUsageEventsTable.reportedCost})`,
  }).from(echoAiUsageEventsTable).where(and(
    eq(echoAiUsageEventsTable.ownerId, ownerId),
    eq(echoAiUsageEventsTable.monthKey, month),
  )).groupBy(echoAiUsageEventsTable.category);
  const categories = Object.fromEntries(AI_USAGE_CATEGORIES.map(category => [category, {
    calls: 0, units: 0, promptTokens: 0, completionTokens: 0, reportedCost: null as string | null,
  }])) as Record<AiUsageCategory, { calls: number; units: number; promptTokens: number; completionTokens: number; reportedCost: string | null }>;
  for (const row of rows) categories[row.category] = {
    calls: Number(row.calls), units: Number(row.units), promptTokens: Number(row.promptTokens),
    completionTokens: Number(row.completionTokens), reportedCost: row.reportedCost,
  };
  return {
    month,
    categories,
    totalUnits: Object.values(categories).reduce((total, category) => total + category.units, 0),
  };
}

export async function configureAiBudget(ownerId: string, input: {
  monthlyHardCeilingUnits: number;
  autonomyReservePercent: number;
  categoryWeights: Record<AiUsageCategory, number>;
}) {
  if (!input.categoryWeights || typeof input.categoryWeights !== "object" || Array.isArray(input.categoryWeights) ||
    !Number.isSafeInteger(input.monthlyHardCeilingUnits) ||
    input.monthlyHardCeilingUnits < 1 ||
    input.monthlyHardCeilingUnits > MAX_MONTHLY_HARD_CEILING_UNITS ||
    !Number.isSafeInteger(input.autonomyReservePercent) ||
    input.autonomyReservePercent < MIN_AUTONOMY_RESERVE_PERCENT ||
    input.autonomyReservePercent > MAX_AUTONOMY_RESERVE_PERCENT ||
    AI_USAGE_CATEGORIES.some(category => {
      const weight = input.categoryWeights[category];
      return !Number.isSafeInteger(weight) || weight < 1 || weight > MAX_CATEGORY_WEIGHT;
    })) {
    throw new Error("INVALID_INTERNAL_AI_BUDGET_CONFIGURATION");
  }
  await db.transaction(async tx => {
    await ensureEntitlements(tx, ownerId);
    await tx.update(echoCreatorEntitlementsTable).set({
      monthlyHardCeilingUnits: input.monthlyHardCeilingUnits,
      autonomyReservePercent: input.autonomyReservePercent,
      categoryWeights: input.categoryWeights,
      updatedAt: new Date(),
    }).where(eq(echoCreatorEntitlementsTable.ownerId, ownerId));
  });
  return creatorUsageSummary(ownerId);
}
