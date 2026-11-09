import type { ImageGenerationReference } from './imageGenerationPayload';
import type { ImageGenerationResult } from './imageGenerationProvider';
import { falProEditEstimatedCostUsd, FAL_OUTPUT_WIDTH, FAL_OUTPUT_HEIGHT } from './falImagePricing';

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
  // Validate all reference payloads before any potentially billable request.
  for (const ref of input.references) {
    if (!['image/jpeg', 'image/png', 'image/webp'].includes(ref.mimeType) ||
        !ref.bytes.length || ref.bytes.length > 15_000_000) throw Error('INVALID_IMAGE_REFERENCE');
  }
  // The budget ledger records a conservative estimated charge, not a provider invoice.
  // Any discrepancy is retained against the reserved ceiling until reconciled.
  const estimatedCostUsd = falProEditEstimatedCostUsd(input.references);
  const fetchImpl = input.fetchImpl ?? fetch;
  const image_urls = input.references.map(ref =>
    `data:${ref.mimeType};base64,${ref.bytes.toString('base64')}`);
  const response = await fetchImpl('https://fal.run/fal-ai/flux-2-pro/edit', {
    method: 'POST',
    headers: { Authorization: `Key ${input.apiKey}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({
      prompt: input.prompt, image_urls, image_size: { width: FAL_OUTPUT_WIDTH, height: FAL_OUTPUT_HEIGHT },
      output_format: 'jpeg', sync_mode: true, enable_safety_checker: true,
    }),
    signal: AbortSignal.timeout(120_000),
  });
  if (!response.ok) {
    if (response.status === 422) {
      // Read once: Response bodies cannot be consumed twice.
      const detail = await response.json().catch(() => null) as any;
      const fields = Array.isArray(detail?.detail) ? detail.detail : [];
      const safeFields = fields.slice(0, 8).map((e: any) => ({
        field: Array.isArray(e?.loc) ? e.loc.filter((x: unknown) => typeof x === 'string' || typeof x === 'number').slice(0, 5).join('.') : 'unknown',
        type: typeof e?.type === 'string' ? e.type.slice(0, 64) : 'unknown',
      }));
      console.error('FAL_IMAGE_VALIDATION_FIELDS', JSON.stringify(safeFields));
      if (fields.some((entry: any) => entry?.type === 'content_policy_violation')) {
        const rejected = fields.some((entry: any) => Array.isArray(entry?.loc) && entry.loc.includes('image_urls'))
          ? 'references' : 'prompt';
        throw Error('FAL_IMAGE_CONTENT_POLICY_' + rejected.toUpperCase());
      }
    }
    throw Error(`FAL_IMAGE_HTTP_${response.status}`);
  }
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw Error('FAL_IMAGE_RESPONSE_TOO_LARGE');
  const raw = await response.text();
  if (Buffer.byteLength(raw) > MAX_BYTES) throw Error('FAL_IMAGE_RESPONSE_TOO_LARGE');
  let payload: any;
  try { payload = JSON.parse(raw); } catch { throw Error('FAL_IMAGE_INVALID_JSON'); }
  const image = await resolveFalImagePayload(payload, fetchImpl);
  // This is the conservative locally computed amount, NOT a verified fal invoice.
  // The caller reserves a larger ceiling and must not display it as actual billing.
  return { ...image, provider: 'fal.ai', model: FAL_IMAGE_MODEL, billedUsd: estimatedCostUsd };

}

/**
 * Convert a fal.ai response to image bytes. Hosted URLs are fetched only from
 * the known fal.ai image CDN over HTTPS, with redirects disabled and size caps.
 * This is intentionally separate from the billable provider request.
 */
export async function resolveFalImagePayload(payload: unknown, fetchImpl: typeof fetch = fetch): Promise<{ bytes: Buffer; mimeType: 'image/jpeg' }> {
  const image = falImageObject(payload);
  const url = image.url;
  if (url.startsWith('data:image/jpeg;base64,')) return parseFalImagePayload(payload);
  let parsed: URL;
  try { parsed = new URL(url); } catch { throw Error('FAL_IMAGE_INVALID_URL'); }
  if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port ||
      !['fal.media', 'v3.fal.media', 'storage.googleapis.com'].includes(parsed.hostname) ||
      parsed.hostname === 'storage.googleapis.com' && !parsed.pathname.startsWith('/fal-cdn/')) {
    throw Error('FAL_IMAGE_URL_NOT_ALLOWED');
  }
  const response = await fetchImpl(url, { redirect: 'error', signal: AbortSignal.timeout(30000) });
  if (!response.ok || !response.body) throw Error('FAL_IMAGE_DOWNLOAD_FAILED');
  if (Number(response.headers.get('content-length') || 0) > MAX_BYTES) throw Error('FAL_IMAGE_TOO_LARGE');
  const mime = response.headers.get('content-type')?.split(';')[0]?.toLowerCase();
  if (mime !== 'image/jpeg') throw Error('FAL_IMAGE_UNEXPECTED_MIME');
  const chunks: Buffer[] = [];
  let size = 0;
  for await (const chunk of response.body) {
    const bytes = Buffer.from(chunk);
    size += bytes.length;
    if (size > MAX_BYTES) throw Error('FAL_IMAGE_TOO_LARGE');
    chunks.push(bytes);
  }
  const bytes = Buffer.concat(chunks);
  validateJpeg(bytes);
  return { bytes, mimeType: 'image/jpeg' };
}

function falImageObject(payload: unknown): { url: string } {
  if (!payload || typeof payload !== 'object') throw Error('FAL_IMAGE_INVALID_RESPONSE');
  const images = (payload as { images?: unknown }).images;
  if (!Array.isArray(images) || images.length !== 1) throw Error('FAL_IMAGE_UNEXPECTED_COUNT');
  const image = images[0];
  if (!image || typeof image !== 'object') throw Error('FAL_IMAGE_INVALID_RESPONSE');
  const url = (image as { url?: unknown }).url;
  if (typeof url !== 'string' || !url) throw Error('FAL_IMAGE_INVALID_URL');
  return { url };
}
function validateJpeg(bytes: Buffer): void {
  if (bytes.length < 4 || bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 ||
      bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw Error('FAL_IMAGE_INVALID_BYTES');
}

/**
 * Offline response parser. fal.ai may return a data URI when sync_mode is
 * enabled, or a hosted image URL. Hosted URLs are rejected until a bounded,
 * allowlisted downloader is implemented.
 *
 * The estimated price is deliberately NOT represented as billedUsd here:
 * reconciliation must be explicit before a paid request is permitted.
 */
export function parseFalImagePayload(payload: unknown): { bytes: Buffer; mimeType: 'image/jpeg' } {
  const { url } = falImageObject(payload);
  if (!url.startsWith('data:image/jpeg;base64,')) {
    throw Error('FAL_IMAGE_HOSTED_URL_NOT_YET_SUPPORTED');
  }
  const encoded = url.slice('data:image/jpeg;base64,'.length);
  if (!encoded || encoded.length > Math.ceil(MAX_BYTES * 4 / 3) + 4 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw Error('FAL_IMAGE_INVALID_BASE64');
  const bytes = Buffer.from(encoded, 'base64');
  if (!bytes.length || bytes.length > MAX_BYTES || bytes[0] !== 0xff || bytes[1] !== 0xd8 || bytes[bytes.length - 2] !== 0xff || bytes[bytes.length - 1] !== 0xd9) throw Error('FAL_IMAGE_INVALID_BYTES');
  return { bytes, mimeType: 'image/jpeg' };
}

/** Extract the provider's request identifier without trusting arbitrary headers. */
export function falRequestId(headers: Pick<Headers, 'get'>): string | null {
  const id = headers.get('x-fal-request-id');
  return id && /^[a-zA-Z0-9_-]{8,128}$/.test(id) ? id : null;
}
