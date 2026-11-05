import { decodeGeneratedImageDataUrl } from './imageGenerationResponse';
import type { ImageGenerationReference } from './imageGenerationPayload';
import { IMAGE_GENERATION_MODEL, type ImageGenerationResult } from './imageGenerationProvider';

/**
 * OpenRouter's dedicated Images API contract (not chat completions).
 * Pure serialization and parsing; intentionally no HTTP calls or billing.
 */
export function buildOpenRouterImageRequest(prompt: string, references: ImageGenerationReference[]) {
  if (!prompt.trim() || prompt.length > 14000) throw Error('INVALID_IMAGE_PROMPT');
  if (references.length > 4) throw Error('TOO_MANY_IMAGE_REFERENCES');
  let total = 0;
  const input_references = references.map(ref => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(ref.mimeType)) throw Error('INVALID_IMAGE_REFERENCE_TYPE');
    if (!ref.bytes.length || ref.bytes.length > 15_000_000) throw Error('INVALID_IMAGE_REFERENCE_SIZE');
    total += ref.bytes.length;
    if (total > 40_000_000) throw Error('IMAGE_REFERENCES_TOO_LARGE');
    return { type: 'image_url' as const, image_url: { url: `data:${ref.mimeType};base64,${ref.bytes.toString('base64')}` } };
  });
  return { model: IMAGE_GENERATION_MODEL, prompt, n: 1, resolution: '1K' as const, ...(input_references.length ? { input_references } : {}) };
}

export function parseOpenRouterImageResponse(value: unknown): ImageGenerationResult {
  if (!value || typeof value !== 'object') throw Error('IMAGE_PROVIDER_RESPONSE_INVALID');
  const response = value as { data?: Array<{ b64_json?: string; media_type?: string }>; usage?: { cost?: number } };
  if (!Array.isArray(response.data) || response.data.length !== 1) throw Error('IMAGE_PROVIDER_IMAGE_COUNT_INVALID');
  const output = response.data[0];
  if (!output || typeof output.b64_json !== 'string') throw Error('IMAGE_PROVIDER_IMAGE_MISSING');
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(output.media_type ?? '')) throw Error('IMAGE_PROVIDER_MIME_INVALID');
  const { bytes, mimeType } = decodeGeneratedImageDataUrl(`data:${output.media_type};base64,${output.b64_json}`);
  const billedUsd = response.usage?.cost;
  if (typeof billedUsd !== 'number' || !Number.isFinite(billedUsd) || billedUsd < 0) throw Error('IMAGE_PROVIDER_COST_UNKNOWN');
  return { bytes, mimeType, provider: 'openrouter', model: IMAGE_GENERATION_MODEL, billedUsd };
}
