/** Only scene-visible human events may be copied into a shared Kindroid group.
 * Private or audience-restricted events must never leave ECHO.
 */
export type SceneSyncCandidate = {
  eventId: string;
  actorId: string;
  text: string;
  visibility: string;
  audienceIds: unknown;
};
export function isKindroidGroupSyncableEvent(
  event: SceneSyncCandidate,
  currentCharacterId: string,
  participantIds: readonly string[],
): boolean {
  if (!event.eventId || event.actorId !== currentCharacterId ||
      !participantIds.includes(event.actorId)) return false;
  if (event.visibility !== "public" && event.visibility !== "participants") return false;
  if (!Array.isArray(event.audienceIds) || event.audienceIds.length !== 0) return false;
  if (typeof event.text !== "string" || !event.text.trim() || event.text.length > 5000) return false;
  return true;
}
