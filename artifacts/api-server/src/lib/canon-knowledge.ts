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
  return events.filter(event => {
    // An explicitly restricted audience always overrides a public flag.
    if (event.audienceIds?.length) {
      return event.audienceIds.includes(characterId) || event.witnessIds.includes(characterId);
    }
    return event.visibility === "public" || event.witnessIds.includes(characterId);
  })
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

/** DM proposals are limited to the exact two participants; hidden messages
 * are not eligible for the review queue. No cross-conversation aggregation.
 */
export function dmCanonCandidates(messages: Array<Record<string, unknown>>, viewerId: string, peerId: string) {
  if (!viewerId || !peerId || viewerId === peerId) return [];
  const eligible = messages.filter(message => {
    const sender = message.senderId;
    const recipient = message.recipientId;
    const hidden = message.hiddenForIds;
    return ((sender === viewerId && recipient === peerId) ||
      (sender === peerId && recipient === viewerId)) &&
      (!Array.isArray(hidden) || (!hidden.includes(viewerId) && !hidden.includes(peerId)));
  }).map(message => ({
    id: message.id, senderId: message.senderId,
    text: message.text ?? message.body, createdAt: message.createdAt,
  }));
  return privateConversationCandidates(eligible, [viewerId, peerId]);
}

/** Validates persisted, per-event access metadata before any AI prompt sees it.
 * Invalid or legacy unscoped entries fail closed.
 */
export function readableCanonTimeline(raw: unknown, characterId: string): string {
  if (!Array.isArray(raw) || !characterId) return "";
  const events: CanonKnowledge[] = [];
  for (const item of raw.slice(-100)) {
    if (!item || typeof item !== "object") continue;
    const row = item as Record<string, unknown>;
    if (typeof row.text !== "string" || !row.text.trim() || row.text.length > 1200 ||
        !["public","participants","private"].includes(String(row.visibility)) ||
        !Array.isArray(row.witnessIds) || row.witnessIds.length > 31 ||
        !row.witnessIds.every(value => typeof value === "string" && value.length > 0 && value.length <= 120) ||
        (row.visibility !== "public" && row.witnessIds.length === 0) ||
        (row.audienceIds !== undefined &&
          (!Array.isArray(row.audienceIds) ||
           !row.audienceIds.every(value => typeof value === "string" && value.length > 0 && value.length <= 120)))) continue;
    events.push({ text: row.text, visibility: row.visibility as CanonKnowledge["visibility"],
      witnessIds: row.witnessIds as string[],
      audienceIds: Array.isArray(row.audienceIds) ? row.audienceIds.filter((value): value is string => typeof value === "string") : [] });
  }
  return knownCanonForCharacter(events, characterId).join("\n").slice(-4000);
}
