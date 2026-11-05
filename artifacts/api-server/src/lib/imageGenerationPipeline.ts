import type { ImageGenerationStyle, ImageGenerationResult } from './imageGenerationProvider';
import { prepareImageMessage, type ImageGenerationReference, type PreparedImageMessage } from './imageGenerationPayload';
import { decodeGeneratedImageDataUrl } from './imageGenerationResponse';

/**
 * Network-free pipeline core. Production code must reserve the global budget
 * before calling a paid provider and settle the reservation afterward.
 * This module deliberately has no network calls or credentials.
 */
export interface ImagePipelineInput {
  prompt: string;
  style: ImageGenerationStyle;
  references: ImageGenerationReference[];
}
export interface ImageProviderEnvelope {
  images: Array<{ image_url: { url: string } }>;
  usage?: { cost?: number };
}
export function prepareImagePipeline(input: ImagePipelineInput): PreparedImageMessage {
  return prepareImageMessage(input.prompt, input.style, input.references);
}
export function parseImagePipelineResult(response: unknown, provider: string, model: string): ImageGenerationResult {
  if (!response || typeof response !== 'object' || !('images' in response)) throw Error('IMAGE_PROVIDER_RESPONSE_INVALID');
  const images = (response as ImageProviderEnvelope).images;
  if (!Array.isArray(images) || images.length !== 1) throw Error('IMAGE_PROVIDER_IMAGE_COUNT_INVALID');
  const dataUrl = images[0]?.image_url?.url;
  const { bytes, mimeType } = decodeGeneratedImageDataUrl(dataUrl);
  const usage = (response as ImageProviderEnvelope).usage;
  const billedUsd = usage?.cost;
  // No unverified price is ever assumed to be zero.
  if (typeof billedUsd !== 'number' || !Number.isFinite(billedUsd) || billedUsd < 0) {
    throw Error('IMAGE_PROVIDER_COST_UNKNOWN');
  }
  return { bytes, mimeType, provider, model, billedUsd };
}
