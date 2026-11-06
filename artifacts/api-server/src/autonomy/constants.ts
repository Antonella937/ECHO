/** Live autonomy requires explicit deployment opt-in and real legal documents. */
import { LEGAL_DOCUMENTS_AVAILABLE } from "../lib/ownerConsent";

export function autonomyProductionGate(env: {
  ECHO_AUTONOMY_LIVE_ENABLED?: string;
  NODE_ENV?: string;
} = process.env, legalDocumentsAvailable = LEGAL_DOCUMENTS_AVAILABLE): boolean {
  return env.NODE_ENV === "production" &&
    env.ECHO_AUTONOMY_LIVE_ENABLED === "true" &&
    legalDocumentsAvailable;
}

/** Private beta requires an explicit server-only flag and a nonempty exact Clerk owner allowlist. */
const privateBetaOwners = new Set((process.env.ECHO_AUTONOMY_PRIVATE_BETA_OWNER_IDS ?? "")
  .split(",").map((id) => id.trim()).filter((id) => /^user_[A-Za-z0-9]{15,64}$/.test(id)));
export const AUTONOMY_PRIVATE_BETA_ENABLED = process.env.NODE_ENV === "production" &&
  process.env.ECHO_AUTONOMY_PRIVATE_BETA_ENABLED === "true" &&
  privateBetaOwners.size > 0;
export function isAutonomyOwnerAuthorized(ownerId: string): boolean {
  return autonomyProductionGate() || (AUTONOMY_PRIVATE_BETA_ENABLED && privateBetaOwners.has(ownerId));
}
export const AUTONOMY_LIVE_EXECUTION_ENABLED = autonomyProductionGate() || AUTONOMY_PRIVATE_BETA_ENABLED;
export const DEFAULT_CHARACTER_CONTROL = {
  enabled: false,
  dmEnabled: false,
  maxActionsPerDay: 2,
  minCooldownMinutes: 360,
};

let isolatedTestLiveOverride = false;

/** Effective process gate; the production default remains permanently off. */
export function isAutonomyLiveExecutionEnabled() {
  return AUTONOMY_LIVE_EXECUTION_ENABLED || isolatedTestLiveOverride;
}

/**
 * Temporarily opens the executor gate only inside a Clerk test-key development
 * process. The worker deliberately continues to use the hard-off base constant.
 */
export async function withIsolatedAutonomyLiveEnabledForTest<T>(operation: () => Promise<T>): Promise<T> {
  const devTestOnly =
    process.env.NODE_ENV !== "production" &&
    process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") === true &&
    process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true &&
    (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN.endsWith(".replit.dev"));
  if (!devTestOnly || isolatedTestLiveOverride) throw new Error("ISOLATED_LIVE_TEST_GATE_UNAVAILABLE");
  isolatedTestLiveOverride = true;
  try {
    return await operation();
  } finally {
    isolatedTestLiveOverride = false;
  }
}
