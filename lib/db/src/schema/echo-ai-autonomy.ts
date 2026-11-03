import {
  boolean,
  index,
  integer,
  pgTable,
  primaryKey,
  serial,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

/** Owner-level controls are separate from the social universe and default to paused. */
export const echoAutonomyOwnersTable = pgTable("echo_ai_autonomy_owners", {
  ownerId: text("owner_id").primaryKey(),
  killSwitchEngaged: boolean("kill_switch_engaged").notNull().default(true),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Explicit opt-in is required for each character; no account is opted in by default. */
export const echoAutonomyCharactersTable = pgTable("echo_ai_autonomy_characters", {
  ownerId: text("owner_id").notNull(),
  characterId: text("character_id").notNull(),
  enabled: boolean("enabled").notNull().default(false),
  maxActionsPerDay: integer("max_actions_per_day").notNull().default(2),
  minCooldownMinutes: integer("min_cooldown_minutes").notNull().default(360),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.characterId] }),
  index("echo_ai_autonomy_characters_owner_idx").on(table.ownerId),
]);

/**
 * Minimal private run ledger: no prompts, private messages, generated text, or secrets.
 * `executed` is reserved for a future reviewed executor; this stage never writes it.
 */
export const echoAutonomyRunsTable = pgTable("echo_ai_autonomy_runs", {
  id: serial("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  characterId: text("character_id").notNull(),
  idempotencyKey: text("idempotency_key").notNull(),
  status: text("status").notNull(),
  action: text("action"),
  situation: text("situation"),
  targetId: text("target_id"),
  sourceRevision: integer("source_revision").notNull(),
  contextHash: text("context_hash"),
  model: text("model"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("echo_ai_autonomy_runs_owner_idem_idx").on(table.ownerId, table.idempotencyKey),
  index("echo_ai_autonomy_runs_owner_character_time_idx").on(table.ownerId, table.characterId, table.createdAt),
]);

export type EchoAutonomyOwner = typeof echoAutonomyOwnersTable.$inferSelect;
export type EchoAutonomyCharacter = typeof echoAutonomyCharactersTable.$inferSelect;
export type EchoAutonomyRun = typeof echoAutonomyRunsTable.$inferSelect;
