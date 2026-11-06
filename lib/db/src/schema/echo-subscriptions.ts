import { pgTable, text, timestamp } from "drizzle-orm/pg-core";

/** Billing provider is authoritative when enabled; no row means Free. */
export const echoSubscriptionsTable = pgTable("echo_subscriptions", {
  ownerId: text("owner_id").primaryKey(),
  plan: text("plan").$type<"free" | "plus" | "premium">().notNull().default("free"),
  status: text("status").$type<"active" | "trialing" | "past_due" | "canceled">().notNull().default("canceled"),
  currentPeriodEnd: timestamp("current_period_end", { withTimezone: true }),
  updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
});
