import { index, integer, numeric, pgTable, text, timestamp, uniqueIndex } from 'drizzle-orm/pg-core';

/**
 * Independent provider-currency budget. Existing AI "units" are not USD and
 * must never be treated as a payment limit.
 */
export const echoImageBudgetMonthsTable = pgTable('echo_image_budget_months', {
  monthKey: text('month_key').primaryKey(),
  /** Global limit shared by all beta users, expressed in integer USD microcents (1 USD = 100000000). */
  ceilingMicroUsd: integer('ceiling_micro_usd').notNull().default(0),
  reservedMicroUsd: integer('reserved_micro_usd').notNull().default(0),
  spentMicroUsd: integer('spent_micro_usd').notNull().default(0),
  updatedAt: timestamp('updated_at', { withTimezone: true }).notNull().defaultNow(),
});

export const echoImageGenerationJobsTable = pgTable('echo_image_generation_jobs', {
  id: text('id').primaryKey(),
  ownerId: text('owner_id').notNull(),
  universeId: text('universe_id').notNull(),
  characterId: text('character_id').notNull(),
  monthKey: text('month_key').notNull(),
  status: text('status').$type<'reserved' | 'succeeded' | 'failed' | 'unknown'>().notNull(),
  reservedMicroUsd: integer('reserved_micro_usd').notNull(),
  reportedCostUsd: numeric('reported_cost_usd', { precision: 14, scale: 8 }),
  provider: text('provider').notNull(),
  model: text('model').notNull(),
  objectPath: text('object_path'),
  createdAt: timestamp('created_at', { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp('finished_at', { withTimezone: true }),
}, t => [
  index('echo_image_jobs_owner_month_idx').on(t.ownerId, t.monthKey),
  uniqueIndex('echo_image_jobs_object_path_idx').on(t.objectPath),
]);
