import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

export const echoMediaTable = pgTable("echo_media", {
  objectPath: text("object_path").primaryKey(),
  ownerId: text("owner_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true })
    .notNull()
    .defaultNow(),
});

export type EchoMedia = typeof echoMediaTable.$inferSelect;
