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
export function sceneCanonCandidates(sceneId: string, rows: Array<Record<string, unknown>>): CanonEventCandidate[] {
  return rows.filter(row =>
    row.visibility === "public" &&
    typeof row.eventId === "string" &&
    typeof row.actorId === "string" &&
    typeof row.text === "string" &&
    looksLikeNarrativeEvent(row.text) &&
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

/** A candidate is a review suggestion, not a factual conclusion. Avoid routine dialogue. */
export function looksLikeNarrativeEvent(text: string): boolean {
  const normalized = text.trim();
  if (normalized.length < 40) return false;
  if (/^(?:hi|hello|hola|hey|ok|okay|gracias|thanks|sí|si|no)[!.\s]*$/i.test(normalized)) return false;
  // Keep this language-agnostic: do not use English/Spanish keyword lists to
  // decide whether a user-written event in another supported language is eligible.
  const words = normalized.split(/\s+/u).filter(Boolean);
  return words.length >= 7 && /[.!?。！？]/u.test(normalized);
}
