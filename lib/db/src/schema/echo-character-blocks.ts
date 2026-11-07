import { sql } from "drizzle-orm";
import { check, foreignKey, index, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { echoUniversesTable } from "./echo-universes";

/** Directed character blocks. Both identities are fully owner/universe scoped. */
export const echoCharacterBlocksTable = pgTable("echo_character_blocks", {
  blockerOwnerId: text("blocker_owner_id").notNull(),
  blockerUniverseId: text("blocker_universe_id").notNull(),
  blockerCharacterId: text("blocker_character_id").notNull(),
  blockedOwnerId: text("blocked_owner_id").notNull(),
  blockedUniverseId: text("blocked_universe_id").notNull(),
  blockedCharacterId: text("blocked_character_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ name: "echo_character_blocks_pk", columns: [
    table.blockerOwnerId, table.blockerUniverseId, table.blockerCharacterId,
    table.blockedOwnerId, table.blockedUniverseId, table.blockedCharacterId,
  ] }),
  foreignKey({ name: "echo_character_blocks_blocker_universe_fk",
    columns: [table.blockerOwnerId, table.blockerUniverseId],
    foreignColumns: [echoUniversesTable.ownerId, echoUniversesTable.universeId],
  }).onDelete("cascade"),
  foreignKey({ name: "echo_character_blocks_blocked_universe_fk",
    columns: [table.blockedOwnerId, table.blockedUniverseId],
    foreignColumns: [echoUniversesTable.ownerId, echoUniversesTable.universeId],
  }).onDelete("cascade"),
  check("echo_character_blocks_not_self_check", sql`NOT (
    ${table.blockerOwnerId} = ${table.blockedOwnerId} AND
    ${table.blockerUniverseId} = ${table.blockedUniverseId} AND
    ${table.blockerCharacterId} = ${table.blockedCharacterId})`),
  index("echo_character_blocks_blocked_idx").on(table.blockedOwnerId, table.blockedUniverseId, table.blockedCharacterId),
]);
