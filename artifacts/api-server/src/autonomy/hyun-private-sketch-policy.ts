/**
 * Explicit opt-in scope for the private-beta sketch experiment.
 *
 * This policy does not schedule or generate images by itself. Call it before
 * any billable autonomous image request, then enforce the monthly/daily counts
 * transactionally in the persistent job ledger (not in process memory).
 */
export const HYUN_PRIVATE_SKETCH_LIMITS = Object.freeze({
  monthlySucceededOrUncertainAttempts: 3,
  dailySucceededOrUncertainAttempts: 1,
  channel: "dm" as const,
});

export interface PrivateSketchScope {
  ownerId: string;
  senderHandle: string;
  recipientHandle: string;
  channel: "dm" | "post" | "story" | "group";
  explicitlyEnabled: boolean;
}

/** Fail closed for every other owner, account, recipient and channel. */
export function canAttemptHyunPrivateSketch(input: PrivateSketchScope): boolean {
  const normalize = (value: string) => value.trim().toLowerCase().replace(/^@/, "");
  return input.ownerId === "user_3LeoBfUicTthDVixNbkPlqXFkdZ"
    && input.explicitlyEnabled
    && input.channel === HYUN_PRIVATE_SKETCH_LIMITS.channel
    && normalize(input.senderHandle) === "hyunnn"
    && normalize(input.recipientHandle) === "nela";
}

/**
 * Failed/unknown provider calls still count as attempts until reconciled.
 * The caller must atomically reserve the attempt in the DB before invoking fal.ai.
 */
export function privateSketchWithinLimits(monthlyAttempts: number, dailyAttempts: number): boolean {
  return Number.isInteger(monthlyAttempts) && monthlyAttempts >= 0
    && Number.isInteger(dailyAttempts) && dailyAttempts >= 0
    && monthlyAttempts < HYUN_PRIVATE_SKETCH_LIMITS.monthlySucceededOrUncertainAttempts
    && dailyAttempts < HYUN_PRIVATE_SKETCH_LIMITS.dailySucceededOrUncertainAttempts;
}
