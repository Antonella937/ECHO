import {
  index,
  integer,
  jsonb,
  numeric,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type CreatorPlan = "free" | "creator";
export type AiUsageCategory = "autonomy" | "brain_text" | "memory_context" | "vision" | "images";

/** Entitlements are server-owned. Add-on counters only change through a future trusted billing/admin flow. */
export const echoCreatorEntitlementsTable = pgTable("echo_creator_entitlements", {
  ownerId: text("owner_id").primaryKey(),
  plan: text("plan").$type<CreatorPlan>().notNull().default("free"),
  addonCharacters: integer("addon_characters").notNull().default(0),
  addonUniverses: integer("addon_universes").notNull().default(0),
  /** Temporary internal safety ceiling, not a customer-facing plan allowance. */
  monthlyHardCeilingUnits: integer("monthly_hard_ceiling_units").notNull().default(500),
  /** Keep a non-autonomy reserve whenever an internal ceiling is configured. */
  autonomyReservePercent: integer("autonomy_reserve_percent").notNull().default(20),
  categoryWeights: jsonb("category_weights").$type<Record<AiUsageCategory, number>>().notNull().default({
    autonomy: 1,
    brain_text: 1,
    memory_context: 1,
    vision: 5,
    images: 10,
  }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** One row per provider-backed operation; prompt/content are never stored. */
export const echoAiUsageEventsTable = pgTable("echo_ai_usage_events", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  monthKey: text("month_key").notNull(),
  category: text("category").$type<AiUsageCategory>().notNull(),
  operation: text("operation").notNull(),
  status: text("status").$type<"reserved" | "succeeded" | "failed" | "blocked">().notNull(),
  chargedUnits: integer("charged_units").notNull().default(0),
  reservedUnits: integer("reserved_units").notNull().default(0),
  promptTokens: integer("prompt_tokens"),
  completionTokens: integer("completion_tokens"),
  reportedCost: numeric("reported_cost", { precision: 14, scale: 8 }),
  provider: text("provider"),
  model: text("model"),
  attemptCount: integer("attempt_count").notNull().default(0),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  finishedAt: timestamp("finished_at", { withTimezone: true }),
}, (table) => [
  index("echo_ai_usage_owner_month_idx").on(table.ownerId, table.monthKey),
  index("echo_ai_usage_owner_category_month_idx").on(table.ownerId, table.category, table.monthKey),
]);

export type EchoCreatorEntitlement = typeof echoCreatorEntitlementsTable.$inferSelect;
export type EchoAiUsageEvent = typeof echoAiUsageEventsTable.$inferSelect;
