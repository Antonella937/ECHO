/** Explicit knowledge visibility. A universe owner can review everything,
 * but AI characters may only receive facts they witnessed or were told.
 */
export type CanonKnowledge = {
  text: string;
  visibility: "public" | "participants" | "private";
  witnessIds: string[];
  audienceIds?: string[];
};
export function knownCanonForCharacter(events: CanonKnowledge[], characterId: string): string[] {
  return events.filter(event => event.visibility === "public" ||
    event.witnessIds.includes(characterId) ||
    (event.audienceIds ?? []).includes(characterId))
    .map(event => event.text);
}
/** Private conversations may produce review candidates but never public canon. */
export function privateConversationCandidates(rows: Array<Record<string, unknown>>, participantIds: string[]) {
  return rows.filter(row => typeof row.id === "string" && typeof row.senderId === "string" &&
    participantIds.includes(row.senderId) && typeof row.text === "string" &&
    localNarrativeFilter(row.text)).slice(-30).map(row => ({
      sourceId: row.id as string, actorId: row.senderId as string,
      text: (row.text as string).trim().slice(0,1200),
      witnessIds: [...participantIds], visibility: "participants" as const,
      occurredAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
      status: "pending" as const,
    }));
}
import { looksLikeNarrativeEvent as localNarrativeFilter } from "./canon-event-candidates";
