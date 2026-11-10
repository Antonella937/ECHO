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
    && normalize(input.recipientHandle) === "antonella.paez";
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


/**
 * A private unfinished sketch is an artwork, not a photograph of Hyun or Nela.
 * Keep the scene independent from identity-reference generation to avoid
 * accidental portraits and expensive multi-reference edits.
 */
export function buildHyunPrivateSketchPrompt(subject: string): string {
  const clean = subject.trim().replace(/\s+/g, " ");
  if (clean.length < 3 || clean.length > 240) throw Error("INVALID_PRIVATE_SKETCH_SUBJECT");
  return [
    "Create a realistic phone photograph of a physical sketchbook page on an artist's desk.",
    "The drawing is an original, visibly unfinished graphite and ink study.",
    "Show tentative construction lines, eraser marks, uneven shading and blank areas.",
    "Avoid polished digital artwork, signatures, watermarks, text overlays, portraits of identifiable real people, and logos.",
    `Subject of the unfinished study: ${clean}.`,
    "Natural indoor light, casual imperfect framing, believable paper and pencil textures.",
  ].join(" ");
}

/** Only the authorized owner may initiate the narrowly scoped experiment. */
export function assertHyunPrivateSketchEligible(
  scope: PrivateSketchScope,
  monthlyAttempts: number,
  dailyAttempts: number,
): void {
  if (!canAttemptHyunPrivateSketch(scope)) throw Error("PRIVATE_SKETCH_SCOPE_DENIED");
  if (!privateSketchWithinLimits(monthlyAttempts, dailyAttempts)) throw Error("PRIVATE_SKETCH_QUOTA_EXHAUSTED");
}


/**
 * Compatibility guard for callers that still use the older policy interface.
 * Explicit character intent is required; a random draw is no longer permission
 * to generate a billable attachment. Both spontaneous DMs and replies qualify.
 */
export function shouldOfferHyunPrivateSketch(input: {
  scope: PrivateSketchScope;
  isUnsolicited: boolean;
  alreadyHasImage: boolean;
  monthlyAttempts: number;
  dailyAttempts: number;
  random: number;
  characterOfferedSketch?: boolean;
}): boolean {
  if (input.alreadyHasImage || input.characterOfferedSketch !== true) return false;
  return canAttemptHyunPrivateSketch(input.scope) &&
    privateSketchWithinLimits(input.monthlyAttempts, input.dailyAttempts);
}

/** Never use a user's chat message as permission for billable autonomous media. */
export function privateSketchRequiresExplicitOwnerOptIn(value: unknown): boolean {
  return value === true;
}
