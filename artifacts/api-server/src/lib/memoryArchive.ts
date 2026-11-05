import type { SocialState } from "@workspace/api-zod";

/**
 * Only previously persisted memories that actually left a character's recent
 * window qualify. Never archive untrusted new client-supplied memories.
 */
export function displacedMemories(previous: SocialState, incoming: SocialState) {
  const nextById = new Map(incoming.characters.map(c => [c.id, c]));
  return previous.characters.flatMap(character => {
    if (character.archived || !character.configuration) return [];
    const next = nextById.get(character.id);
    if (!next || next.archived || !next.configuration) return [];
    const retained = new Set(next.configuration.memory.recent.map(m => m.id));
    const nextRecent = next.configuration.memory.recent;
    // Only a full, advancing recent window is a rollover. Removing memories
    // manually or shrinking the window must not manufacture archive events.
    const limit = Math.max(0, Math.min(next.configuration.memory.recentLimit, 50));
    if (limit === 0 || nextRecent.length < limit) return [];
    const oldestRetainedAt = Math.min(...nextRecent.map(m => new Date(m.createdAt).getTime()));
    return character.configuration.memory.recent
      .filter(m => !retained.has(m.id) && !!m.sourceId && m.id === `autonomy-event:${m.sourceId}` &&
        new Date(m.createdAt).getTime() <= oldestRetainedAt)
      .map(m => ({
        characterId: character.id,
        memoryId: m.id,
        sourceId: m.sourceId,
        kind: m.kind,
        targetId: m.targetId,
        content: m.text,
        occurredAt: new Date(m.createdAt),
      }));
  });
}
