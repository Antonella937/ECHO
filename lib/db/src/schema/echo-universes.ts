import { integer, jsonb, pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const echoUniversesTable = pgTable("echo_universes", {
  ownerId: text("owner_id").primaryKey(),
  revision: integer("revision").notNull().default(1),
  state: jsonb("state").$type<Record<string, unknown>>().notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EchoUniverse = typeof echoUniversesTable.$inferSelect;
