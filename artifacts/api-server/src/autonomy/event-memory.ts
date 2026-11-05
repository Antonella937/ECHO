import type { SocialState } from "@workspace/api-zod";

/**
 * Record a verifiable social event in the acting character's recent memory.
 * No inference, LLM, private cross-thread access, or automatic promotion.
 * Only events with actual persisted source IDs are eligible.
 */
export function recordAutonomyEvent(
  state: SocialState,
  actorId: string,
  input: { sourceId: string; kind: "post" | "interaction" | "conversation"; text: string; targetId?: string | null },
  now: Date,
): SocialState {
  const index = state.characters.findIndex(character => character.id === actorId && !character.archived);
  if (index < 0 || !input.sourceId.trim()) return state;
  const actor = state.characters[index];
  const config = actor.configuration;
  if (!config) return state;
  const text = input.text.trim();
  // Avoid filling memory with trivial reactions, greetings and one-word messages.
  if (text.length < 24) return state;
  if (config.memory.recent.some(item => item.sourceId === input.sourceId)) return state;
  const limit = Math.max(0, Math.min(config.memory.recentLimit, 50));
  if (limit === 0) return state;
  const entry = {
    id: `autonomy-event:${input.sourceId}`,
    text: text.slice(0, 400),
    targetId: input.targetId ?? null,
    kind: input.kind,
    createdAt: now,
    updatedAt: now,
    sourceId: input.sourceId,
    promotedTo: null,
  };
  const recent = [...config.memory.recent, entry].slice(-limit);
  return {
    ...state,
    characters: state.characters.map((character, i) => i === index ? {
      ...character,
      configuration: { ...config, memory: { ...config.memory, recent } },
    } : character),
  };
}
