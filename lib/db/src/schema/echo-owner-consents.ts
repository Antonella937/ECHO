import { boolean, pgTable, primaryKey, text, timestamp } from "drizzle-orm/pg-core";
import { createInsertSchema } from "drizzle-zod";

/** Alpha draft acknowledgements only. Never evidence of legally valid acceptance or age verification. */
export const echoOwnerConsentsTable = pgTable("echo_owner_consents", {
  ownerId: text("owner_id").notNull(),
  version: text("version").notNull(),
  adultDeclared: boolean("adult_declared").notNull().default(false),
  fictionAcknowledged: boolean("fiction_acknowledged").notNull().default(false),
  legalDraftAcknowledged: boolean("legal_draft_acknowledged").notNull().default(false),
  acknowledgedAt: timestamp("acknowledged_at", { withTimezone: true }).notNull().defaultNow(),
}, table => [primaryKey({ columns: [table.ownerId, table.version] })]);

export const insertOwnerConsentSchema = createInsertSchema(echoOwnerConsentsTable).omit({ acknowledgedAt: true });
export type EchoOwnerConsent = typeof echoOwnerConsentsTable.$inferSelect;
