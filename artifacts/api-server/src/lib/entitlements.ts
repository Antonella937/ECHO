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

/** Membership capacity; Creator is a profile hub, not a paid tier. */
export const ECHO_PLAN_CAPACITY: Readonly<Record<EchoPlan, { maxUniverses: number; maxCharacters: number }>> = Object.freeze({
  free: { maxUniverses: 1, maxCharacters: 5 },
  plus: { maxUniverses: 3, maxCharacters: 15 },
  premium: { maxUniverses: 5, maxCharacters: 25 },
});

/** Monthly character-generated audio quota. Incoming user voice notes are free of this quota. */
export const ECHO_AUDIO_POLICY = Object.freeze({
 monthlyCredits: { free: 0, plus: 30, premium: 100 } as const,
 maxGeneratedAudioSeconds: 30,
 creditsPerGeneratedAudio: 1,
});


/**
 * Launch pricing and credit policy, shared by future server-side wallet handlers.
 * Catalog only: does not grant balances, charge cards, or authorize generation.
 * All prices are USD cents to avoid floating-point billing errors.
 */
export const ECHO_CREDIT_POLICY = Object.freeze({
  monthlyPlans: {
    free: { priceCents: 0, photoCredits: 10, voiceCredits: 0 },
    plus: { priceCents: 1299, photoCredits: 60, voiceCredits: 30 },
    premium: { priceCents: 2499, photoCredits: 150, voiceCredits: 100 },
  },
  packs: {
    photo20: { kind: "photo", credits: 20, priceCents: 299 },
    photo50: { kind: "photo", credits: 50, priceCents: 649 },
    photo100: { kind: "photo", credits: 100, priceCents: 1199 },
    voice50: { kind: "voice", credits: 50, priceCents: 299 },
  },
  costs: {
    standardPhoto: 1,
    groupPhoto: 2,
    premiumPhoto: 3,
    basicVoice: 1,
    customVoice: 2,
  },
  monthlyRewardCaps: {
    free: { photo: 5, voice: 0 },
    plus: { photo: 15, voice: 0 },
    premium: { photo: 25, voice: 5 },
  },
  rewardExpiresAfterDays: 30,
  customVoiceMonthlyMaintenanceCents: 100,
  /** Actual billing remains disabled until provider pricing and checkout are verified. */
  checkoutEnabled: false,
  /** No credit grants or deductions before a transactional database ledger exists. */
  walletEnabled: false,
} as const);
