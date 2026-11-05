import { index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

/** Private, append-only memories displaced from each character's recent window. */
export const echoMemoryArchiveTable = pgTable("echo_memory_archive", {
  ownerId: text("owner_id").notNull(),
  universeId: text("universe_id").notNull(),
  characterId: text("character_id").notNull(),
  memoryId: text("memory_id").notNull(),
  sourceId: text("source_id"),
  kind: text("kind").notNull(),
  targetId: text("target_id"),
  content: text("content").notNull(),
  occurredAt: timestamp("occurred_at", { withTimezone: true }).notNull(),
  archivedAt: timestamp("archived_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [
  primaryKey({ columns: [table.ownerId, table.universeId, table.characterId, table.memoryId] }),
  index("echo_memory_archive_scope_time_idx").on(table.ownerId, table.universeId, table.characterId, table.occurredAt),
]);
