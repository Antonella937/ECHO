import type { SocialState } from "@workspace/api-zod";

/** Tension is directional and independent of trust, closeness and attraction.
 * Only source-linked, explicitly owner-verified events may change it.
 */
export type TensionEventKind =
  | "argument_confirmed"
  | "boundary_crossed"
  | "unresolved_conflict"
  | "apology_accepted"
  | "reconciliation_confirmed"
  | "conflict_resolved";

export type VerifiedTensionEvent = {
  sourceId: string;
  actorId: string;
  targetId: string;
  kind: TensionEventKind;
  occurredAt: Date;
  verified: true;
};

const DELTAS: Record<TensionEventKind, number> = {
  argument_confirmed: 5,
  boundary_crossed: 8,
  unresolved_conflict: 4,
  apology_accepted: -3,
  reconciliation_confirmed: -7,
  conflict_resolved: -5,
};

export function applyVerifiedTensionEvent(
  state: SocialState,
  event: VerifiedTensionEvent,
  guard: { consumedSourceIds: readonly string[] },
  now: Date,
): { state: SocialState; applied: boolean; reason: string; delta: number } {
  const reject = (reason: string) => ({ state, applied: false, reason, delta: 0 });
  if (!event.sourceId?.trim() || !event.actorId || !event.targetId ||
      event.actorId === event.targetId || event.verified !== true ||
      !Object.prototype.hasOwnProperty.call(DELTAS, event.kind)) return reject("INVALID_EVENT");
  const at = event.occurredAt instanceof Date ? event.occurredAt.getTime() : NaN;
  if (!Number.isFinite(at) || at > now.getTime() ||
      at < now.getTime() - 30 * 24 * 60 * 60_000) return reject("EVENT_OUT_OF_WINDOW");
  if (guard.consumedSourceIds.includes(event.sourceId)) return reject("EVENT_ALREADY_CONSUMED");
  const actor = state.characters.find(c => c.id === event.actorId && !c.archived);
  const target = state.characters.find(c => c.id === event.targetId && !c.archived);
  if (!actor?.configuration || !target) return reject("CHARACTER_NOT_FOUND");
  const relation = actor.configuration.relationships.find(r => r.targetId === event.targetId);
  if (!relation) return reject("RELATIONSHIP_NOT_CONFIGURED");
  if (relation.tension == null) return reject("TENSION_NOT_ENABLED");
  const delta = Math.max(-relation.tension, Math.min(100 - relation.tension, DELTAS[event.kind]));
  if (delta === 0) return reject("TENSION_AT_BOUNDARY");
  return {
    applied: true, reason: "VERIFIED_TENSION_CHANGE", delta,
    state: { ...state, characters: state.characters.map(c => c.id !== actor.id ? c : {
      ...c, configuration: { ...c.configuration!, relationships: c.configuration!.relationships.map(r =>
        r.targetId === event.targetId ? { ...r, tension: relation.tension! + delta } : r) },
    }) },
  };
}
