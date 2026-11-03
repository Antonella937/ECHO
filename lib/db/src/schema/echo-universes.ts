import { boolean, integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const echoUniversesTable = pgTable("echo_universes", {
  ownerId: text("owner_id").notNull(),
  /** Existing owner-scoped data remains the primary universe after migration. */
  universeId: text("universe_id").notNull().default("primary"),
  /** Explicit owner consent for cross-owner social reads; internal visibility is independent. */
  sharingEnabled: boolean("sharing_enabled").notNull().default(false),
  archivedAt: timestamp("archived_at", { withTimezone: true }),
  /** Content-free tombstone prevents stale clients from recreating deleted universes. */
  deletedAt: timestamp("deleted_at", { withTimezone: true }),
  revision: integer("revision").notNull().default(1),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.universeId] })]);

export type EchoUniverse = typeof echoUniversesTable.$inferSelect;
