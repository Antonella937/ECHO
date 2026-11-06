import type { SocialState } from "@workspace/api-zod";

/**
 * Trust changes are based on explicitly verified, source-linked relationship
 * events. Chat frequency, sentiment and model guesses are never evidence.
 * This pure function does not persist anything; the caller must authenticate,
 * enforce owner/universe scope, and atomically consume event IDs.
 */
export type TrustEventKind =
  | "promise_kept"
  | "support_given"
  | "boundary_respected"
  | "lie_confirmed"
  | "promise_broken"
  | "betrayal_confirmed"
  | "repair_confirmed";

export type VerifiedTrustEvent = {
  sourceId: string;
  actorId: string;
  targetId: string;
  kind: TrustEventKind;
  occurredAt: Date;
  verified: true;
};

const DELTAS: Record<TrustEventKind, number> = {
  promise_kept: 2,
  support_given: 2,
  boundary_respected: 1,
  lie_confirmed: -4,
  promise_broken: -3,
  betrayal_confirmed: -8,
  repair_confirmed: 1,
};

export function applyVerifiedTrustEvent(
  state: SocialState,
  event: VerifiedTrustEvent,
  guard: { consumedSourceIds: readonly string[] },
  now: Date,
): { state: SocialState; applied: boolean; reason: string; delta: number } {
  const reject = (reason: string) => ({ state, applied: false, reason, delta: 0 });
  if (!event.sourceId?.trim() || !event.actorId || !event.targetId ||
      event.actorId === event.targetId || event.verified !== true ||
      !(event.kind in DELTAS)) return reject("INVALID_EVENT");
  const at = event.occurredAt instanceof Date ? event.occurredAt.getTime() : NaN;
  if (!Number.isFinite(at) || at > now.getTime() ||
      at < now.getTime() - 30 * 24 * 60 * 60_000) return reject("EVENT_OUT_OF_WINDOW");
  if (guard.consumedSourceIds.includes(event.sourceId)) return reject("EVENT_ALREADY_CONSUMED");
  const actor = state.characters.find(c => c.id === event.actorId && !c.archived);
  const target = state.characters.find(c => c.id === event.targetId && !c.archived);
  if (!actor?.configuration || !target) return reject("CHARACTER_NOT_FOUND");
  const relation = actor.configuration.relationships.find(r => r.targetId === event.targetId);
  if (!relation) return reject("RELATIONSHIP_NOT_CONFIGURED");
  const delta = Math.max(-relation.trust, Math.min(100 - relation.trust, DELTAS[event.kind]));
  if (delta === 0) return reject("TRUST_AT_BOUNDARY");
  return {
    applied: true, reason: "VERIFIED_TRUST_CHANGE", delta,
    state: { ...state, characters: state.characters.map(c => c.id !== actor.id ? c : {
      ...c, configuration: { ...c.configuration!, relationships: c.configuration!.relationships.map(r =>
        r.targetId === event.targetId ? { ...r, trust: r.trust + delta } : r) },
    }) },
  };
}
