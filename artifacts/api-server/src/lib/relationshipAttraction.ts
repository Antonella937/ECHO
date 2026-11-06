import type { SocialState } from "@workspace/api-zod";

export type AttractionEventKind =
  | "mutual_flirting_confirmed" | "affection_reciprocated"
  | "romantic_interest_confirmed" | "romantic_boundary_respected"
  | "romantic_interest_declined" | "romantic_distance_confirmed";
export type VerifiedAttractionEvent = {
  sourceId: string; actorId: string; targetId: string;
  kind: AttractionEventKind; occurredAt: Date; verified: true;
};
const changes: Record<AttractionEventKind, number> = {
  mutual_flirting_confirmed: 3, affection_reciprocated: 4,
  romantic_interest_confirmed: 6, romantic_boundary_respected: 1,
  romantic_interest_declined: -5, romantic_distance_confirmed: -4,
};
export function applyVerifiedAttractionEvent(
  state: SocialState, event: VerifiedAttractionEvent,
  guard: { consumedSourceIds: readonly string[] }, now = new Date(),
): { state: SocialState; applied: boolean; reason: string; delta: number } {
  const reject = (reason: string) => ({ state, applied: false, reason, delta: 0 });
  if (!event.sourceId || !event.actorId || !event.targetId || event.actorId === event.targetId || event.verified !== true)
    return reject("INVALID_EVENT");
  if (!Object.prototype.hasOwnProperty.call(changes, event.kind)) return reject("INVALID_KIND");
  if (guard.consumedSourceIds.includes(event.sourceId)) return reject("EVENT_ALREADY_CONSUMED");
  const age = now.getTime() - event.occurredAt.getTime();
  if (!Number.isFinite(age) || age < 0 || age > 30 * 24 * 60 * 60_000) return reject("EVENT_OUTSIDE_WINDOW");
  const actor = state.characters.find(c => c.id === event.actorId && !c.archived);
  const target = state.characters.find(c => c.id === event.targetId && !c.archived);
  const relation = actor?.configuration?.relationships.find(r => r.targetId === event.targetId);
  if (!actor || !target || !relation) return reject("RELATIONSHIP_NOT_CONFIGURED");
  if (relation.attraction == null) return reject("ATTRACTION_DISABLED");
  const next = Math.max(0, Math.min(100, relation.attraction + changes[event.kind]));
  const delta = next - relation.attraction;
  if (!delta) return reject("ATTRACTION_AT_BOUNDARY");
  return {
    applied: true, reason: "APPROVED_ATTRACTION_EVENT", delta,
    state: { ...state, characters: state.characters.map(c => c.id !== event.actorId ? c : {
      ...c, configuration: { ...c.configuration!, relationships: c.configuration!.relationships.map(r =>
        r.targetId === event.targetId ? { ...r, attraction: next } : r) },
    }) },
  };
}
