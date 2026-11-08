import type { ImageGenerationReference } from './imageGenerationPayload';
import type { ImageGenerationResult } from './imageGenerationProvider';

export const FAL_IMAGE_MODEL = 'fal-ai/flux-2-pro/edit';
const MAX_BYTES = 24_000_000;

/**
 * fal.ai FLUX.2 Pro edit adapter. This is only invoked behind the existing
 * paid-generation authorization and atomic budget reservation gates.
 * References are sent as data URIs, never as private Supabase paths.
 * No automatic retries: a timeout may already have incurred a charge.
 */
export async function requestFalImage(input: {
  apiKey: string;
  prompt: string;
  references: ImageGenerationReference[];
  fetchImpl?: typeof fetch;
}): Promise<ImageGenerationResult> {
  if (!input.apiKey.trim()) throw Error('IMAGE_PROVIDER_KEY_MISSING');
  if (!input.references.length || input.references.length > 4) throw Error('FAL_EDIT_REQUIRES_1_TO_4_REFERENCES');
  // IMPORTANT: do not send a billable request until a reliable, bounded\n  // per-request price calculation and reconciliation path is implemented.\n  // A previous version would call fal.ai and only then reject its response,\n  // potentially charging credits without delivering an image.\n  throw Error('FAL_IMAGE_COST_RECONCILIATION_REQUIRED');\n  const fetchImpl = input.fetchImpl ?? fetch;
  const image_urls = input.references.map(ref => {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(ref.mimeType) ||
        !ref.bytes.length || ref.bytes.length > 15_000_000) throw Error('INVALID_IMAGE_REFERENCE');
    return `data:${ref.mimeType};base64,${ref.bytes.toString('base64')}`;
  });
  const response = await fetchImpl('https://fal.run/fal-ai/flux-2-pro/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${input.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: input.prompt, image_urls, image_size: 'portrait_4_3',
      output_format: 'jpeg', sync_mode: true, enable_safety_checker: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) throw Error(`FAL_IMAGE_HTTP_${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw Error('FAL_IMAGE_RESPONSE_TOO_LARGE');
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) throw Error('FAL_IMAGE_RESPONSE_TOO_LARGE');
  let payload: any;
  try { payload = JSON.parse(raw); } catch { throw Error('FAL_IMAGE_INVALID_JSON'); }
  const url = payload?.images?.[0]?.url;
  if (typeof url !== 'string' || !url.startsWith('data:image/jpeg;base64,')) {
    throw Error('FAL_IMAGE_UNEXPECTED_OUTPUT');
  }
  const bytes = Buffer.from(url.slice('data:image/jpeg;base64,'.length), 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8) {
    throw Error('FAL_IMAGE_INVALID_BYTES');
  }
  // fal's model response does not contain authoritative billed USD.
  // Do not fabricate a cost: keep the paid route disabled until a trusted
  // per-request cost reconciliation mechanism is implemented.
  throw Error('FAL_IMAGE_COST_RECONCILIATION_REQUIRED');
}
