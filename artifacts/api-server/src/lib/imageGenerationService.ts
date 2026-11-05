import { IMAGE_GENERATION_MODEL, MAX_IMAGE_COST_USD, type ImageGenerationStyle } from './imageGenerationProvider';
import { canGenerateImages } from './imageGenerationAccess';
import { paidImageGenerationActivated } from './imageGenerationActivation';
import { loadImageReferences } from './imageReferences';
import { reserveImageBudget, settleImageBudget } from './imageBudget';
import { requestOpenRouterImage } from './openRouterImageTransport';
import { saveGeneratedImage } from './generatedImageStorage';
import { orchestrateImageGeneration } from './imageGenerationOrchestrator';

/**
 * Live service composition. Not reachable from any HTTP route until explicit
 * owner consent, provider verification, migration and budget activation.
 * All checks before the first provider call are fail-closed.
 */
export async function generateCharacterImage(input: {
  ownerId: string;
  universeId: string;
  characterId: string;
  preparedPrompt: string;
  style: ImageGenerationStyle;
  referencePaths: string[];
}) {
  if (!paidImageGenerationActivated()) throw Error('PAID_IMAGE_GENERATION_DISABLED');
  if (!canGenerateImages(input.ownerId)) throw Error('IMAGE_GENERATION_ACCOUNT_NOT_ALLOWED');
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw Error('IMAGE_PROVIDER_KEY_MISSING');
  // Verify all private references and download them before any budget reservation.
  const references = await loadImageReferences(input.ownerId, input.referencePaths);
  return orchestrateImageGeneration({
    reserve: reserveImageBudget,
    settle: settleImageBudget,
    store: (ownerId, result) => saveGeneratedImage(ownerId, result.bytes, result.mimeType),
    generate: ({ prompt, references: verified }) => requestOpenRouterImage({ apiKey, prompt, references: verified }),
  }, {
    ownerId: input.ownerId,
    universeId: input.universeId,
    characterId: input.characterId,
    prompt: input.preparedPrompt,
    style: input.style,
    references,
    provider: 'openrouter',
    model: IMAGE_GENERATION_MODEL,
    maximumUsd: MAX_IMAGE_COST_USD,
  });
}
