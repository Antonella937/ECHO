import type { SocialState } from "@workspace/api-zod";

export type RelationshipPreset = "stranger" | "acquaintance" | "friend" | "close_friend" | "family" | "crush" | "romantic_tension" | "partner" | "ex" | "rival" | "custom";
export type TransitionProposal = { from: RelationshipPreset; to: RelationshipPreset; rationale: string; requiresOwnerApproval: true };
const next: Partial<Record<RelationshipPreset, readonly RelationshipPreset[]>> = {
  stranger: ["acquaintance"], acquaintance: ["friend", "rival"],
  friend: ["close_friend", "crush", "rival"], close_friend: ["crush", "romantic_tension"],
  crush: ["romantic_tension", "friend"], romantic_tension: ["partner", "friend"],
  partner: ["ex"], ex: ["friend", "romantic_tension"], rival: ["acquaintance", "friend"],
};
export function proposeRelationshipTransitions(
  state: SocialState, actorId: string, targetId: string,
): TransitionProposal[] {
  const actor = state.characters.find(c => c.id === actorId && !c.archived);
  const target = state.characters.find(c => c.id === targetId && !c.archived);
  const relation = actor?.configuration?.relationships.find(r => r.targetId === targetId);
  if (!actor || !target || !relation || relation.preset === "family" || relation.preset === "custom") return [];
  const from = relation.preset as RelationshipPreset;
  const closeness = relation.closeness, trust = relation.trust;
  const attraction = relation.attraction ?? 0, tension = relation.tension ?? 0;
  return (next[from] ?? []).filter(to => {
    switch (to) {
      case "acquaintance": return from === "stranger" ? closeness >= 20 : tension <= 45;
      case "friend": return closeness >= 45 && trust >= 40 && tension <= 70;
      case "close_friend": return closeness >= 70 && trust >= 65;
      case "crush": return attraction >= 55 && trust >= 40;
      case "romantic_tension": return attraction >= 65 && closeness >= 45 && trust >= 45;
      case "partner": return attraction >= 75 && closeness >= 65 && trust >= 65 && tension <= 55;
      case "ex": return false; // Breakups are not inferred from scores.
      case "rival": return tension >= 75;
      default: return false;
    }
  }).map(to => ({
    from, to, requiresOwnerApproval: true as const,
    rationale: "Los indicadores del vínculo permiten considerar este cambio; no prueban que haya ocurrido.",
  }));
}
export function applyApprovedRelationshipTransition(
  state: SocialState, actorId: string, targetId: string, from: RelationshipPreset, to: RelationshipPreset,
): { state: SocialState; applied: boolean; reason: string } {
  const actor = state.characters.find(c => c.id === actorId && !c.archived);
  const relation = actor?.configuration?.relationships.find(r => r.targetId === targetId);
  if (!relation || relation.preset !== from || !state.characters.some(c => c.id === targetId && !c.archived))
    return { state, applied: false, reason: "RELATIONSHIP_CHANGED" };
  if (!proposeRelationshipTransitions(state, actorId, targetId).some(p => p.to === to))
    return { state, applied: false, reason: "TRANSITION_NOT_ELIGIBLE" };
  return { applied: true, reason: "TRANSITION_APPROVED", state: {
    ...state, characters: state.characters.map(c => c.id !== actorId ? c : {
      ...c, configuration: { ...c.configuration!, relationships: c.configuration!.relationships.map(r =>
        r.targetId === targetId ? { ...r, preset: to } : r) },
    }),
  } };
}
