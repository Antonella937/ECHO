import { pgTable, text, timestamp } from "drizzle-orm/pg-core";
export const echoInterfaceLanguagesTable = pgTable("echo_interface_languages", {
  ownerId: text("owner_id").primaryKey(),
  language: text("language").notNull(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
