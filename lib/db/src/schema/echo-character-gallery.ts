import { jsonb, boolean, pgTable, text, timestamp, uuid, integer } from "drizzle-orm/pg-core";
export const echoCharacterGalleryTable = pgTable("echo_character_gallery", {
  id: uuid("id").primaryKey().defaultRandom(),
  ownerId: text("owner_id").notNull(),
  universeId: text("universe_id").notNull(),
  characterId: text("character_id").notNull(),
  mediaRef: text("media_ref").notNull(),
  description: text("description").notNull().default(""),
  visionAnalysis: jsonb("vision_analysis").$type<Record<string, unknown> | null>(),
  visionStatus: text("vision_status").notNull().default("pending"),
  reusable: boolean("reusable").notNull().default(false),
  reserved: boolean("reserved").notNull().default(false),
  usedCount: integer("used_count").notNull().default(0),
  lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});
