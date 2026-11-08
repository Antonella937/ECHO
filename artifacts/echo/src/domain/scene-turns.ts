/** Deterministic turn selection for a single ECHO scene. No message dispatch side effects. */
export type SceneTurnMode = 'automatic' | 'manual' | 'ordered';
export interface SceneTurnSettings {
  mode: SceneTurnMode;
  participantIds: string[];
  order: string[];
  nextCharacterId: string | null;
  cursor: number;
}
export function normalizeSceneTurns(input: SceneTurnSettings): SceneTurnSettings {
  const participants = [...new Set(input.participantIds.filter(Boolean))];
  const order = [...new Set(input.order.filter(id => participants.includes(id)))];
  for (const id of participants) if (!order.includes(id)) order.push(id);
  return {
    mode: input.mode,
    participantIds: participants,
    order,
    nextCharacterId: input.nextCharacterId && participants.includes(input.nextCharacterId) ? input.nextCharacterId : null,
    cursor: order.length ? Math.max(0, input.cursor) % order.length : 0,
  };
}
export interface SceneTurnDecision { characterId: string | null; next: SceneTurnSettings }
/**
 * Pick at most one character per turn. Automatic selection uses the provided
 * relevance-ranked candidates; it does not force everyone to speak.
 */
export function selectSceneTurn(settings: SceneTurnSettings, eligibleIds: string[]): SceneTurnDecision {
  const state = normalizeSceneTurns(settings);
  const eligible = new Set(eligibleIds.filter(id => state.participantIds.includes(id)));
  if (!eligible.size) return { characterId: null, next: state };
  if (state.nextCharacterId && eligible.has(state.nextCharacterId)) {
    const characterId = state.nextCharacterId;
    return { characterId, next: { ...state, nextCharacterId: null, cursor: state.order.length ? (state.order.indexOf(characterId) + 1) % state.order.length : 0 } };
  }
  if (state.mode === 'manual') return { characterId: null, next: state };
  if (state.mode === 'automatic') {
    const characterId = eligibleIds.find(id => eligible.has(id)) ?? null;
    return { characterId, next: state };
  }
  for (let offset = 0; offset < state.order.length; offset++) {
    const index = (state.cursor + offset) % state.order.length;
    const id = state.order[index];
    if (eligible.has(id)) return { characterId: id, next: { ...state, cursor: (index + 1) % state.order.length } };
  }
  return { characterId: null, next: state };
}
/** A user can request a particular next speaker without changing the mode. */
export function requestNextSceneSpeaker(settings: SceneTurnSettings, characterId: string): SceneTurnSettings {
  const state = normalizeSceneTurns(settings);
  if (!state.participantIds.includes(characterId)) throw new Error('SCENE_CHARACTER_NOT_PRESENT');
  return { ...state, nextCharacterId: characterId };
}
