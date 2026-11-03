import {
  index,
  integer,
  jsonb,
  pgTable,
  primaryKey,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";

export type EchoVisionStatus = "pending" | "complete" | "failed";

/** One successful visual analysis per owner and byte-identical image. */
export const echoVisionAnalysesTable = pgTable("echo_vision_analyses", {
  id: text("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  universeId: text("universe_id").notNull().default("primary"),
  contentHash: text("content_hash").notNull(),
  mimeType: text("mime_type").notNull(),
  byteSize: integer("byte_size").notNull(),
  status: text("status").$type<EchoVisionStatus>().notNull(),
  provider: text("provider"),
  model: text("model"),
  analysis: jsonb("analysis").$type<Record<string, unknown> | null>(),
  errorCode: text("error_code"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  uniqueIndex("echo_vision_analyses_owner_universe_hash_uq").on(table.ownerId, table.universeId, table.contentHash),
  index("echo_vision_analyses_owner_universe_status_idx").on(table.ownerId, table.universeId, table.status),
]);

/** Stable links preserve each ordered post/story item while sharing cached analysis. */
export const echoVisionMediaRefsTable = pgTable("echo_vision_media_refs", {
  ownerId: text("owner_id").notNull(),
  universeId: text("universe_id").notNull().default("primary"),
  entityType: text("entity_type").$type<"post" | "story">().notNull(),
  entityId: text("entity_id").notNull(),
  mediaId: text("media_id").notNull(),
  position: integer("position").notNull(),
  contentHash: text("content_hash").notNull(),
  sourcePath: text("source_path").notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.universeId, table.entityType, table.entityId, table.mediaId] }),
  index("echo_vision_refs_owner_universe_entity_idx").on(table.ownerId, table.universeId, table.entityType, table.entityId),
  index("echo_vision_refs_owner_universe_hash_idx").on(table.ownerId, table.universeId, table.contentHash),
]);

/** Deterministic, ordered carousel-level summary derived from per-image analyses. */
export const echoVisionPostSummariesTable = pgTable("echo_vision_post_summaries", {
  ownerId: text("owner_id").notNull(),
  universeId: text("universe_id").notNull().default("primary"),
  postId: text("post_id").notNull(),
  contentHash: text("content_hash").notNull(),
  summary: jsonb("summary").$type<Record<string, unknown>>().notNull(),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, (table) => [
  primaryKey({ columns: [table.ownerId, table.universeId, table.postId, table.contentHash] }),
  index("echo_vision_post_summaries_owner_universe_post_idx").on(table.ownerId, table.universeId, table.postId),
]);
