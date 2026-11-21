import { createHash } from "node:crypto";

/** Pure, offline-safe mapping. Never infer an ECHO speaker from untrusted message text. */
export type KindroidSceneMessage = {
  id: string;
  sender: string;
  display_name?: string;
  message: string;
  timestamp: number;
};

export type SceneHistoryEvent = {
  eventId: string;
  actorId: string;
  text: string;
  createdAt: string;
};

export function mapKindroidSceneHistory(
  groupId: string,
  messages: readonly unknown[],
  kinToCharacter: ReadonlyMap<string, string>,
  allowedCharacterIds: ReadonlySet<string>,
): SceneHistoryEvent[] {
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(groupId)) return [];
  const seen = new Set<string>();
  const result: SceneHistoryEvent[] = [];
  for (const raw of messages) {
    if (!raw || typeof raw !== "object" || Array.isArray(raw)) continue;
    const item = raw as Record<string, unknown>;
    if (typeof item.id !== "string" || !item.id.trim() || item.id.length > 256 ||
        typeof item.sender !== "string" || !item.sender.trim()) continue;
    const actorId = kinToCharacter.get(item.sender);
    if (!actorId || !allowedCharacterIds.has(actorId)) continue;
    if (typeof item.message !== "string" || !item.message.trim() || item.message.length > 5000) continue;
    const timestamp = item.timestamp;
    if (typeof timestamp !== "number" || !Number.isFinite(timestamp)) continue;
    const date = new Date(timestamp < 1e11 ? timestamp * 1000 : timestamp);
    if (!Number.isFinite(date.getTime())) continue;
    const eventId = "kindroid_" + createHash("sha256").update(groupId + ":" + item.id).digest("hex").slice(0, 48);
    if (seen.has(eventId)) continue;
    seen.add(eventId);
    result.push({eventId, actorId, text: item.message.trim(), createdAt: date.toISOString()});
  }
  return result.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.eventId.localeCompare(b.eventId));
}
