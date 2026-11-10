import type { ImageGenerationResult } from './imageGenerationProvider';
import type { ImageGenerationStyle } from './imageGenerationProvider';
import type { ImageGenerationReference } from './imageGenerationPayload';
import { prepareImageMessage } from './imageGenerationPayload';

/**
 * Injectable orchestration for deterministic, no-credit integration tests.
 * This does not enable any API route or make a provider call by itself.
 */
export interface GenerationDependencies {
  reserve: (input: { ownerId: string; universeId: string; characterId: string; maximumUsd: number; provider: string; model: string; purpose?: 'hyun_private_sketch' }) => Promise<{ id: string }>;
  generate: (input: { prompt: string; style: ImageGenerationStyle; references: ImageGenerationReference[] }) => Promise<ImageGenerationResult>;
  store: (ownerId: string, result: ImageGenerationResult) => Promise<string>;
  settle: (id: string, outcome: { status: 'succeeded' | 'failed' | 'unknown'; reportedCostUsd?: number; objectPath?: string }) => Promise<void>;
}
export interface GenerationContext {
  ownerId: string;
  universeId: string;
  characterId: string;
  prompt: string;
  style: ImageGenerationStyle;
  references: ImageGenerationReference[];
  provider: string;
  model: string;
  maximumUsd: number;
  purpose?: 'hyun_private_sketch';
}
export async function orchestrateImageGeneration(deps: GenerationDependencies, input: GenerationContext) {
  if (!Number.isFinite(input.maximumUsd) || input.maximumUsd <= 0) throw Error('INVALID_IMAGE_BUDGET');
  // Reject invalid requests before reserving funds. This validation is offline.
  prepareImageMessage(input.prompt, input.style, input.references);
  if (!input.ownerId || !input.universeId || !input.characterId || !input.provider || !input.model) throw Error('INVALID_IMAGE_CONTEXT');
  // The reserve must be committed before calling a potentially billable provider.
  const reservation = await deps.reserve({
    ownerId: input.ownerId, universeId: input.universeId, characterId: input.characterId,
    maximumUsd: input.maximumUsd, provider: input.provider, model: input.model, purpose: input.purpose,
  });
  let result: ImageGenerationResult;
  try {
    result = await deps.generate({ prompt: input.prompt, style: input.style, references: input.references });
  } catch (error) {
    // A provider error or timeout does not prove the provider charged nothing.
    await deps.settle(reservation.id, { status: 'unknown' });
    throw error;
  }
  if (result.provider !== input.provider || result.model !== input.model ||
      !Number.isFinite(result.billedUsd) || result.billedUsd < 0 || result.billedUsd > input.maximumUsd) {
    await deps.settle(reservation.id, { status: 'unknown' });
    throw Error('IMAGE_COST_EXCEEDS_RESERVATION_OR_UNKNOWN');
  }
  let objectPath: string;
  try {
    objectPath = await deps.store(input.ownerId, result);
  } catch (error) {
    // Provider billing is not reconciled: conservatively retain the full reservation.
    await deps.settle(reservation.id, { status: 'failed', reportedCostUsd: input.maximumUsd });
    throw error;
  }
  // Do not release reserved funds based on a model price estimate. The provider's
  // actual charge has not been reconciled, so account for the full cap.
  await deps.settle(reservation.id, { status: 'succeeded', reportedCostUsd: input.maximumUsd, objectPath });
  return { objectPath, billedUsd: result.billedUsd, jobId: reservation.id };
}
