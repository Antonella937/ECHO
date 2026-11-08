import type { ImageGenerationResult } from './imageGenerationProvider';
import { FAL_OUTPUT_WIDTH, FAL_OUTPUT_HEIGHT } from './falImagePricing';
import { resolveFalImagePayload } from './falImageTransport';

/** FLUX.2 Pro text-to-image; separate endpoint, no reference images required. */
export const FAL_TEXT_IMAGE_MODEL = 'fal-ai/flux-2-pro';
export const FAL_TEXT_IMAGE_ESTIMATED_USD = 0.03; // One output megapixel at 768x1024.
export async function requestFalTextImage(input: { apiKey: string; prompt: string; fetchImpl?: typeof fetch }): Promise<ImageGenerationResult> {
  if (!input.apiKey.trim()) throw Error('IMAGE_PROVIDER_KEY_MISSING');
  if (!input.prompt.trim()) throw Error('INVALID_IMAGE_PROMPT');
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl('https://fal.run/fal-ai/flux-2-pro', {
    method: 'POST',
    headers: { Authorization: `Key ${input.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ prompt: input.prompt, image_size: { width: FAL_OUTPUT_WIDTH, height: FAL_OUTPUT_HEIGHT }, output_format: 'jpeg', sync_mode: true, enable_safety_checker: true }),
    signal: AbortSignal.timeout(120_000),
    redirect: 'error',
  });
  if (!response.ok) throw Error(`FAL_TEXT_IMAGE_HTTP_${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > 24_000_000) throw Error('FAL_IMAGE_RESPONSE_TOO_LARGE');
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 24_000_000) throw Error('FAL_IMAGE_RESPONSE_TOO_LARGE');
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw Error('FAL_IMAGE_INVALID_JSON'); }
  const image = await resolveFalImagePayload(payload, fetchImpl);
  return { ...image, provider: 'fal.ai', model: FAL_TEXT_IMAGE_MODEL, billedUsd: FAL_TEXT_IMAGE_ESTIMATED_USD };
}
