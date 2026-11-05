import { eq } from 'drizzle-orm';
import { db, echoImageBudgetMonthsTable } from '@workspace/db';
import { MICRO_USD_PER_DOLLAR, monthKeyUtc, toMicroUsd } from './imageBudget';
import { MAX_IMAGE_COST_USD } from './imageGenerationProvider';

export interface ImageBudgetReadiness {
  monthKey: string;
  ceilingUsd: number;
  spentUsd: number;
  reservedUsd: number;
  remainingUsd: number;
  canReserveOneImage: boolean;
}

/**
 * Read-only budget snapshot. Never creates a budget row or activates spending.
 * A missing row (or failed query) is NOT evidence of an approved budget.
 */
export async function readImageBudgetReadiness(): Promise<ImageBudgetReadiness> {
  const monthKey = monthKeyUtc();
  const [row] = await db.select({
    ceiling: echoImageBudgetMonthsTable.ceilingMicroUsd,
    spent: echoImageBudgetMonthsTable.spentMicroUsd,
    reserved: echoImageBudgetMonthsTable.reservedMicroUsd,
  }).from(echoImageBudgetMonthsTable)
    .where(eq(echoImageBudgetMonthsTable.monthKey, monthKey)).limit(1);
  const ceiling = row?.ceiling ?? 0;
  const spent = row?.spent ?? 0;
  const reserved = row?.reserved ?? 0;
  const remaining = Math.max(0, ceiling - spent - reserved);
  return {
    monthKey,
    ceilingUsd: ceiling / MICRO_USD_PER_DOLLAR,
    spentUsd: spent / MICRO_USD_PER_DOLLAR,
    reservedUsd: reserved / MICRO_USD_PER_DOLLAR,
    remainingUsd: remaining / MICRO_USD_PER_DOLLAR,
    canReserveOneImage: Boolean(row) && ceiling > 0 && remaining >= toMicroUsd(MAX_IMAGE_COST_USD),
  };
}
