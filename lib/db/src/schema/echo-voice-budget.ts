import { boolean, integer, pgTable, text, timestamp, primaryKey } from "drizzle-orm/pg-core";

/** Per-owner voice controls. Opt-in and monthly allowance default to zero. */
export const echoVoiceBudgetsTable = pgTable("echo_voice_budgets", {
  ownerId: text("owner_id").primaryKey(),
  enabled: boolean("enabled").notNull().default(false),
  monthlyCharacterLimit: integer("monthly_character_limit").notNull().default(0),
  maxDailyMessages: integer("max_daily_messages").notNull().default(0),
  preference: text("preference").$type<"off" | "occasional" | "frequent">().notNull().default("off"),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});

/** Atomic character reservation, unique for each owner and message. */
export const echoVoiceUsageTable = pgTable("echo_voice_usage", {
  ownerId: text("owner_id").notNull(),
  messageId: text("message_id").notNull(),
  monthKey: text("month_key").notNull(),
  characterId: text("character_id").notNull(),
  characters: integer("characters").notNull(),
  status: text("status").$type<"reserved" | "succeeded" | "failed">().notNull(),
  objectPath: text("object_path"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, t => [primaryKey({ columns: [t.ownerId, t.messageId] })]);
