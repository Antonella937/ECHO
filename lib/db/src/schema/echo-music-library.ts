import { pgTable, text, integer, timestamp, primaryKey } from "drizzle-orm/pg-core";

/** Owner-scoped music metadata. Audio objects remain private in echo_media. */
export const echoMusicLibraryTable = pgTable("echo_music_library", {
  ownerId: text("owner_id").notNull(),
  id: text("id").notNull(),
  characterId: text("character_id").notNull(),
  title: text("title").notNull(),
  prompt: text("prompt").notNull().default(""),
  durationSeconds: integer("duration_seconds").notNull().default(0),
  status: text("status").$type<"draft" | "saved_audio">().notNull(),
  audioPath: text("audio_path"),
  publishedAt: timestamp("published_at", { withTimezone: true }),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.ownerId, t.id] })]);
