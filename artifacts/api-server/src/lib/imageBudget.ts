import { randomUUID } from 'node:crypto';
import { and, eq, sql } from 'drizzle-orm';
import { db, echoImageBudgetMonthsTable, echoImageGenerationJobsTable } from '@workspace/db';

export const MICRO_USD_PER_DOLLAR = 100_000_000;
export const monthKeyUtc = (date = new Date()) => date.toISOString().slice(0, 7);
export const toMicroUsd = (usd: number) => {
  if (!Number.isFinite(usd) || usd < 0) throw Error('INVALID_IMAGE_COST');
  return Math.ceil(usd * MICRO_USD_PER_DOLLAR);
};

/**
 * Fail-closed atomic reservation. No budget row => zero spending allowed.
 * Reservation is pessimistic: provider cost may be lower, but never higher
 * than the reserved ceiling. Never auto-retry an ambiguous provider failure.
 */
export async function reserveImageBudget(input: {
  ownerId: string; universeId: string; characterId: string;
  provider: string; model: string; maximumUsd: number;
}) {
  const monthKey = monthKeyUtc();
  const reserve = toMicroUsd(input.maximumUsd);
  if (reserve <= 0) throw Error('INVALID_IMAGE_RESERVATION');
  return db.transaction(async tx => {
    const [budget] = await tx.update(echoImageBudgetMonthsTable)
      .set({ reservedMicroUsd: sql`${echoImageBudgetMonthsTable.reservedMicroUsd} + ${reserve}`, updatedAt: new Date() })
      .where(and(
        eq(echoImageBudgetMonthsTable.monthKey, monthKey),
        sql`${echoImageBudgetMonthsTable.ceilingMicroUsd} >= ${echoImageBudgetMonthsTable.reservedMicroUsd} + ${echoImageBudgetMonthsTable.spentMicroUsd} + ${reserve}`,
      )).returning();
    if (!budget) throw Error('IMAGE_MONTHLY_BUDGET_EXHAUSTED_OR_DISABLED');
    const id = randomUUID();
    await tx.insert(echoImageGenerationJobsTable).values({
      id, ownerId: input.ownerId, universeId: input.universeId, characterId: input.characterId,
      monthKey, status: 'reserved', reservedMicroUsd: reserve, provider: input.provider, model: input.model,
    });
    return { id, monthKey, reservedMicroUsd: reserve };
  });
}

/**
 * On a provider timeout keep the entire reservation as spent ("unknown"):
 * the provider may have billed us even if the response was lost.
 */
export async function settleImageBudget(id: string, outcome: {
  status: 'succeeded' | 'failed' | 'unknown';
  reportedCostUsd?: number;
  objectPath?: string;
}) {
  return db.transaction(async tx => {
    const [job] = await tx.select().from(echoImageGenerationJobsTable)
      .where(eq(echoImageGenerationJobsTable.id, id)).for('update').limit(1);
    if (!job || job.status !== 'reserved') throw Error('IMAGE_JOB_NOT_RESERVABLE');
    const reported = outcome.reportedCostUsd === undefined ? undefined : toMicroUsd(outcome.reportedCostUsd);
    if (reported !== undefined && reported > job.reservedMicroUsd) throw Error('IMAGE_PROVIDER_COST_EXCEEDS_RESERVATION');
    const charged = outcome.status === 'unknown' ? job.reservedMicroUsd :
      outcome.status === 'failed' ? (reported ?? job.reservedMicroUsd) : (reported ?? job.reservedMicroUsd);
    await tx.update(echoImageBudgetMonthsTable).set({
      reservedMicroUsd: sql`${echoImageBudgetMonthsTable.reservedMicroUsd} - ${job.reservedMicroUsd}`,
      spentMicroUsd: sql`${echoImageBudgetMonthsTable.spentMicroUsd} + ${charged}`,
      updatedAt: new Date(),
    }).where(eq(echoImageBudgetMonthsTable.monthKey, job.monthKey));
    await tx.update(echoImageGenerationJobsTable).set({
      status: outcome.status, reportedCostUsd: outcome.reportedCostUsd?.toFixed(8),
      objectPath: outcome.objectPath, finishedAt: new Date(),
    }).where(eq(echoImageGenerationJobsTable.id, id));
  });
}
