import { sql } from "drizzle-orm";
import {
  check,
  foreignKey,
  index,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
  uuid,
} from "drizzle-orm/pg-core";
import { echoUniversesTable } from "./echo-universes";

export type CharacterFollowRequestStatus =
  | "pending"
  | "accepted"
  | "rejected"
  | "cancelled";

/** Active follows are relational and scoped by both endpoint identities. */
export const echoCharacterFollowsTable = pgTable("echo_character_follows", {
  sourceOwnerId: text("source_owner_id").notNull(),
  sourceUniverseId: text("source_universe_id").notNull(),
  sourceCharacterId: text("source_character_id").notNull(),
  targetOwnerId: text("target_owner_id").notNull(),
  targetUniverseId: text("target_universe_id").notNull(),
  targetCharacterId: text("target_character_id").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({
    name: "echo_character_follows_identity_pk",
    columns: [
      table.sourceOwnerId,
      table.sourceUniverseId,
      table.sourceCharacterId,
      table.targetOwnerId,
      table.targetUniverseId,
      table.targetCharacterId,
    ],
  }),
  foreignKey({
    name: "echo_character_follows_source_universe_fk",
    columns: [table.sourceOwnerId, table.sourceUniverseId],
    foreignColumns: [echoUniversesTable.ownerId, echoUniversesTable.universeId],
  }).onDelete("cascade"),
  foreignKey({
    name: "echo_character_follows_target_universe_fk",
    columns: [table.targetOwnerId, table.targetUniverseId],
    foreignColumns: [echoUniversesTable.ownerId, echoUniversesTable.universeId],
  }).onDelete("cascade"),
  check(
    "echo_character_follows_not_self_check",
    sql`NOT (
      ${table.sourceOwnerId} = ${table.targetOwnerId}
      AND ${table.sourceUniverseId} = ${table.targetUniverseId}
      AND ${table.sourceCharacterId} = ${table.targetCharacterId}
    )`,
  ),
  index("echo_character_follows_target_idx").on(
    table.targetOwnerId,
    table.targetUniverseId,
    table.targetCharacterId,
  ),
]);

/**
 * Request history is retained through terminal states. A partial unique index
 * guarantees at most one pending request for a source/target character pair.
 */
export const echoCharacterFollowRequestsTable = pgTable("echo_character_follow_requests", {
  id: uuid("id").primaryKey().defaultRandom(),
  sourceOwnerId: text("source_owner_id").notNull(),
  sourceUniverseId: text("source_universe_id").notNull(),
  sourceCharacterId: text("source_character_id").notNull(),
  targetOwnerId: text("target_owner_id").notNull(),
  targetUniverseId: text("target_universe_id").notNull(),
  targetCharacterId: text("target_character_id").notNull(),
  status: text("status").$type<CharacterFollowRequestStatus>().notNull().default("pending"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  foreignKey({
    name: "echo_character_follow_requests_source_universe_fk",
    columns: [table.sourceOwnerId, table.sourceUniverseId],
    foreignColumns: [echoUniversesTable.ownerId, echoUniversesTable.universeId],
  }).onDelete("cascade"),
  foreignKey({
    name: "echo_character_follow_requests_target_universe_fk",
    columns: [table.targetOwnerId, table.targetUniverseId],
    foreignColumns: [echoUniversesTable.ownerId, echoUniversesTable.universeId],
  }).onDelete("cascade"),
  check(
    "echo_character_follow_requests_status_check",
    sql`${table.status} in ('pending', 'accepted', 'rejected', 'cancelled')`,
  ),
  check(
    "echo_character_follow_requests_not_self_check",
    sql`NOT (
      ${table.sourceOwnerId} = ${table.targetOwnerId}
      AND ${table.sourceUniverseId} = ${table.targetUniverseId}
      AND ${table.sourceCharacterId} = ${table.targetCharacterId}
    )`,
  ),
  uniqueIndex("echo_character_follow_requests_pending_pair_uq")
    .on(
      table.sourceOwnerId,
      table.sourceUniverseId,
      table.sourceCharacterId,
      table.targetOwnerId,
      table.targetUniverseId,
      table.targetCharacterId,
    )
    .where(sql`${table.status} = 'pending'`),
  index("echo_character_follow_requests_target_status_idx").on(
    table.targetOwnerId,
    table.status,
    table.createdAt,
  ),
  index("echo_character_follow_requests_source_status_idx").on(
    table.sourceOwnerId,
    table.status,
    table.createdAt,
  ),
]);
