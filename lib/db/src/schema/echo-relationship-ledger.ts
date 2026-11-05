import { index, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Owner-scoped record of explicitly approved relationship changes. */
export const echoRelationshipLedgerTable = pgTable("echo_relationship_ledger", {
  ownerId: text("owner_id").notNull(),
  universeId: text("universe_id").notNull(),
  actorId: text("actor_id").notNull(),
  targetId: text("target_id").notNull(),
  lastAppliedAt: timestamp("last_applied_at", { withTimezone: true }).notNull(),
  appliedCount: integer("applied_count").notNull().default(0),
  consumedMessageIds: jsonb("consumed_message_ids").$type<string[]>().notNull().default([]),
}, table => [
  primaryKey({ columns: [table.ownerId, table.universeId, table.actorId, table.targetId] }),
  index("echo_relationship_ledger_scope_idx").on(table.ownerId, table.universeId, table.actorId),
]);
