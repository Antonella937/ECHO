import { db, echoSubscriptionsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { lifetimeAccessForOwner } from "./lifetimeAccess";

export type EchoPlan = "free" | "plus" | "premium";
/** Server-only plan resolution; never trust a client-supplied plan. */
export async function resolveEchoPlan(ownerId: string): Promise<EchoPlan> {
  if (lifetimeAccessForOwner(ownerId) !== null) return "premium";
  const [subscription] = await db.select().from(echoSubscriptionsTable)
    .where(eq(echoSubscriptionsTable.ownerId, ownerId)).limit(1);
  if (!subscription || !["active", "trialing"].includes(subscription.status) ||
    !subscription.currentPeriodEnd || subscription.currentPeriodEnd.getTime() <= Date.now()) return "free";
  return subscription.plan;
}
export async function canUseBasicVoices(ownerId: string): Promise<boolean> {
  const plan = await resolveEchoPlan(ownerId);
  return plan === "plus" || plan === "premium";
}
