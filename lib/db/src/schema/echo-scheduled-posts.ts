import { pgTable, uuid, text, timestamp } from "drizzle-orm/pg-core";
export const echoScheduledPostsTable = pgTable("echo_scheduled_posts", {
 id: uuid("id").primaryKey().defaultRandom(),
 ownerId: text("owner_id").notNull(), universeId: text("universe_id").notNull(),
 characterId: text("character_id").notNull(), galleryPhotoId: uuid("gallery_photo_id").notNull(),
 caption: text("caption").notNull(), scheduledAt: timestamp("scheduled_at",{withTimezone:true}).notNull(),
 status: text("status").notNull().default("pending"), postId: text("post_id"),
 createdAt: timestamp("created_at",{withTimezone:true}).notNull().defaultNow(),
 publishedAt: timestamp("published_at",{withTimezone:true}),
});