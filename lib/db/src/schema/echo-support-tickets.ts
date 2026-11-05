import { pgTable, text, timestamp, uuid, varchar, index } from "drizzle-orm/pg-core";

export const echoSupportTicketsTable = pgTable("echo_support_tickets", {
  id: uuid("id").primaryKey(),
  ownerId: text("owner_id").notNull(),
  category: text("category").notNull(),
  area: varchar("area", { length: 120 }).notNull().default(""),
  description: varchar("description", { length: 4000 }).notNull(),
  status: text("status").notNull().default("open"),
  adminNote: varchar("admin_note", { length: 2000 }).notNull().default(""),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [index("echo_support_tickets_owner_created_idx").on(table.ownerId, table.createdAt)]);
