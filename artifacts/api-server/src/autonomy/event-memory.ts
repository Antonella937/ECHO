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
  const combined = [...config.memory.recent, entry];
  const evicted = combined.slice(0, Math.max(0, combined.length - limit));
  const recent = combined.slice(-limit);
  // Source-linked, deterministic digest: never invents interpretations.
  // Full durable historical retention is handled in a later stage.
  const lines = evicted.map(item =>
    `[${item.kind}:${item.sourceId ?? item.id}] ${item.text.replace(/\s+/g, " ").slice(0, 180)}`);
  const summary = [config.memory.recentSummary.trim(), ...lines]
    .filter(Boolean).join("\n").split("\n");
  const recentSummary = summary.slice(-30).join("\n").slice(-6000);
  return {
    ...state,
    characters: state.characters.map((character, i) => i === index ? {
      ...character,
      configuration: { ...config, memory: { ...config.memory, recent, recentSummary } },
    } : character),
  };
}
