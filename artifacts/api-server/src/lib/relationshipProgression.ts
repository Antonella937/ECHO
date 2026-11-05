import type { SocialState } from "@workspace/api-zod";

/**
 * Explicitly requested, conservative relationship progression.
 * Pure state transformation: the caller must authenticate, check the revision,
 * and persist through the normal owner/universe CAS repository.
 */
export function applyApprovedClosenessProgression(
  state: SocialState,
  actorId: string,
  targetId: string,
  now: Date,
): { state: SocialState; applied: boolean; reason: string } {
  if (!actorId || !targetId || actorId === targetId) {
    return { state, applied: false, reason: "INVALID_PAIR" };
  }
  const actor = state.characters.find(c => c.id === actorId && !c.archived);
  const target = state.characters.find(c => c.id === targetId && !c.archived);
  if (!actor?.configuration || !target) return { state, applied: false, reason: "CHARACTER_NOT_FOUND" };
  const relationship = actor.configuration.relationships.find(r => r.targetId === targetId);
  if (!relationship) return { state, applied: false, reason: "RELATIONSHIP_NOT_CONFIGURED" };
  const cutoff = now.getTime() - 30 * 24 * 60 * 60_000;
  const messages = state.messages.filter(m => {
    const at = new Date(m.createdAt).getTime();
    return !m.hiddenForIds?.includes(actorId) &&
      Number.isFinite(at) && at >= cutoff && at <= now.getTime() &&
      ((m.senderId === actorId && m.recipientId === targetId) ||
        (m.senderId === targetId && m.recipientId === actorId));
  });
  const sent = messages.filter(m => m.senderId === actorId).length;
  const received = messages.filter(m => m.senderId === targetId).length;
  const days = new Set(messages.map(m => new Date(m.createdAt).toISOString().slice(0, 10))).size;
  if (sent < 3 || received < 3 || days < 3)
    return { state, applied: false, reason: "INSUFFICIENT_RECIPROCAL_CONTACT" };
  if (relationship.closeness >= 100)
    return { state, applied: false, reason: "CLOSENESS_AT_MAXIMUM" };
  return {
    applied: true, reason: "APPROVED_INCREMENT",
    state: { ...state, characters: state.characters.map(c => c.id !== actorId ? c : {
      ...c, configuration: { ...c.configuration!, relationships: c.configuration!.relationships.map(r =>
        r.targetId === targetId ? { ...r, closeness: Math.min(100, r.closeness + 1) } : r) },
    }) },
  };
}
