/** Conservative, read-only candidate extraction. Never treats a character's claim as canon. */
export interface CanonEventCandidate {
  sourceId: string;
  sourceType: "scene";
  sceneId: string;
  text: string;
  actorId: string;
  occurredAt: string;
  status: "pending";
}
export function sceneCanonCandidates(sceneId: string, rows: Array<{
  eventId: unknown; actorId: unknown; text: unknown; createdAt: unknown;
  visibility: unknown; audienceIds: unknown;
}>): CanonEventCandidate[] {
  return rows.filter(row =>
    row.visibility === "public" &&
    typeof row.eventId === "string" &&
    typeof row.actorId === "string" &&
    typeof row.text === "string" &&
    row.text.trim().length >= 40 &&
    row.text.length <= 5000 &&
    // Private and audience-restricted information must never become global canon.
    (!Array.isArray(row.audienceIds) || row.audienceIds.length === 0)
  ).slice(-30).map(row => ({
    sourceId: row.eventId as string,
    sourceType: "scene" as const,
    sceneId,
    text: (row.text as string).trim().slice(0, 1200),
    actorId: row.actorId as string,
    occurredAt: row.createdAt instanceof Date ? row.createdAt.toISOString() : String(row.createdAt ?? ""),
    status: "pending" as const,
  }));
}
