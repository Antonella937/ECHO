import { integer, jsonb, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";

export const echoUniversesTable = pgTable("echo_universes", {
  ownerId: text("owner_id").notNull(),
  /** Existing owner-scoped data remains the primary universe after migration. */
  universeId: text("universe_id").notNull().default("primary"),
  revision: integer("revision").notNull().default(1),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
}, (table) => [primaryKey({ columns: [table.ownerId, table.universeId] })]);

export type EchoUniverse = typeof echoUniversesTable.$inferSelect;
