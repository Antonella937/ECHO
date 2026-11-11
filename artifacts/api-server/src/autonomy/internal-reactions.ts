/**
 * Internal reactions are private creator-only narrative observations, not social
 * actions. A view never implies a like, comment, DM, or character knowledge.
 */
export type InternalReactionSurface = 'post' | 'story';
export type InternalReactionMode = 'automatic' | 'manual';

export interface InternalReactionCandidate {
  characterId: string;
  contentId: string;
  surface: InternalReactionSurface;
  authorId: string;
  actuallyViewed: boolean;
  audienceAllowed: boolean;
  blocked: boolean;
  autonomyEnabled: boolean;
  publiclyResponded: boolean;
  /** A manual inspection may happen without a prior view receipt; never pretend it was viewed. */
  manualInspectionAllowed?: boolean;
}

/** Stable sampling prevents a new reaction every time a feed is refreshed. */
function stableFraction(value: string): number {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) {
    hash ^= value.charCodeAt(i);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0x100000000;
}

/**
 * Returns eligibility, not permission to write. The caller must separately
 * enforce founder authorization, provider opt-in, per-character cooldown,
 * idempotent storage, and Kindroid API budget before generating any text.
 */
export function shouldGenerateInternalReaction(
  candidate: InternalReactionCandidate,
  mode: InternalReactionMode,
  automaticProbability = 0.22,
): boolean {
  if (!(candidate.actuallyViewed || (mode === 'manual' && candidate.manualInspectionAllowed)) || !candidate.audienceAllowed || candidate.blocked ||
      candidate.characterId === candidate.authorId || candidate.publiclyResponded) return false;
  if (mode === 'manual') return true;
  if (!candidate.autonomyEnabled) return false;
  const probability = Math.max(0, Math.min(1, automaticProbability));
  return stableFraction(`${candidate.characterId}:${candidate.surface}:${candidate.contentId}:internal-reaction:v1`) < probability;
}

/** Narration is private; it must not imply a public action or invent knowledge. */
export function internalReactionPrompt(surface: InternalReactionSurface, visibleCaption: string): string {
  return `You just viewed this ${surface} in ECHO. Write a brief PRIVATE internal reaction in your established narrative voice: thoughts, feelings, or physical reaction, without forcing dialogue. You may feel indifferent, conflicted, amused or anything consistent with your personality. This is NOT a comment, like, DM or notification to the author. Do not claim knowledge of private facts, unseen media, or events not in the provided context. Do not write a public response. Visible caption: ${visibleCaption.slice(0, 1200)}`;
}
