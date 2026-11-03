import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  pgTable,
  primaryKey,
  text,
  timestamp,
} from "drizzle-orm/pg-core";
import { echoUniversesTable } from "./echo-universes";

export type CharacterVisibility = "public" | "private";

/**
 * Owner-controlled, per-character visibility. Missing legacy values are
 * backfilled as public; new character writes receive the same default.
 */
export const echoCharacterPrivacyTable = pgTable("echo_character_privacy", {
  ownerId: text("owner_id").notNull(),
  universeId: text("universe_id").notNull().default("primary"),
  characterId: text("character_id").notNull(),
  visibility: text("visibility").$type<CharacterVisibility>().notNull().default("public"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.universeId, table.characterId] }),
  foreignKey({
    name: "echo_character_privacy_universe_fk",
    columns: [table.ownerId, table.universeId],
    foreignColumns: [echoUniversesTable.ownerId, echoUniversesTable.universeId],
  }).onDelete("cascade"),
  check(
    "echo_character_privacy_visibility_check",
    sql`${table.visibility} in ('public', 'private')`,
  ),
]);

export type EchoCharacterPrivacy = typeof echoCharacterPrivacyTable.$inferSelect;
