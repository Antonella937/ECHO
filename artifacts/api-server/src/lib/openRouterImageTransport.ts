import { buildOpenRouterImageRequest, parseOpenRouterImageResponse } from './openRouterImageAdapter';
import type { ImageGenerationReference } from './imageGenerationPayload';
import type { ImageGenerationResult } from './imageGenerationProvider';

const ENDPOINT = 'https://openrouter.ai/api/v1/images/generations';
const MAX_RESPONSE_BYTES = 24_000_000;

/**
 * Single-attempt image request. Must only be called by a budget-reserved,
 * allowlisted, explicitly enabled orchestration. Never retry ambiguous errors.
 * fetchImpl is injectable for offline tests.
 */
export async function requestOpenRouterImage(input: {
  apiKey: string;
  prompt: string;
  references: ImageGenerationReference[];
  fetchImpl?: typeof fetch;
}): Promise<ImageGenerationResult> {
  if (!input.apiKey || !input.apiKey.trim()) throw Error('IMAGE_PROVIDER_KEY_MISSING');
  const body = buildOpenRouterImageRequest(input.prompt, input.references);
  const fetchImpl = input.fetchImpl ?? fetch;
  const response = await fetchImpl(ENDPOINT, {
    method: 'POST',
    headers: {
      Authorization: `Bearer ${input.apiKey}`,
      'Content-Type': 'application/json',
      Accept: 'application/json',
    },
    body: JSON.stringify(body),
    signal: AbortSignal.timeout(90_000),
  });
  if (!response.ok) throw Error(`IMAGE_PROVIDER_HTTP_${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > MAX_RESPONSE_BYTES) throw Error('IMAGE_PROVIDER_RESPONSE_TOO_LARGE');
  if (!response.body) throw Error('IMAGE_PROVIDER_RESPONSE_EMPTY');
  const chunks: Uint8Array[] = [];
  let total = 0;
  for await (const part of response.body) {
    const chunk = part instanceof Uint8Array ? part : new Uint8Array(part);
    total += chunk.byteLength;
    if (total > MAX_RESPONSE_BYTES) {
      await response.body.cancel().catch(() => {});
      throw Error('IMAGE_PROVIDER_RESPONSE_TOO_LARGE');
    }
    chunks.push(chunk);
  }
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  let json: unknown;
  try { json = JSON.parse(bytes.toString('utf8')); }
  catch { throw Error('IMAGE_PROVIDER_INVALID_JSON'); }
  return parseOpenRouterImageResponse(json);
}
