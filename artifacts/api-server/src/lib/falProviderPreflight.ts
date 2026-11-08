import { FAL_IMAGE_MODEL } from './falImageTransport';
import { FAL_TEXT_IMAGE_MODEL } from './falTextImageTransport';

/**
 * Non-billable fal.ai Platform API probe. Never transmits prompts or images.
 * This verifies the key can read the model's current pricing, NOT that
 * paid image generation is activated or that a charge can be reconciled.
 */
export async function probeFalImagePricing(apiKey: string, fetchImpl: typeof fetch = fetch) {
  if (!apiKey.trim()) throw Error('FAL_KEY_MISSING');
  const url = new URL('https://api.fal.ai/v1/models/pricing');
  url.searchParams.set('endpoint_id', [FAL_IMAGE_MODEL, FAL_TEXT_IMAGE_MODEL].join(','));
  const response = await fetchImpl(url.toString(), {
    method: 'GET',
    headers: { Authorization: `Key ${apiKey}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error(`FAL_PRICING_HTTP_${response.status}`);
  if (Number(response.headers.get('content-length') || 0) > 32768) throw Error('FAL_PRICING_RESPONSE_TOO_LARGE');
  const raw = await response.text();
  if (Buffer.byteLength(raw) > 32768) throw Error('FAL_PRICING_RESPONSE_TOO_LARGE');
  let payload: unknown;
  try { payload = JSON.parse(raw); } catch { throw Error('FAL_PRICING_INVALID_JSON'); }
  if (!payload || typeof payload !== 'object' || !Array.isArray((payload as any).prices)) throw Error('FAL_PRICING_INVALID_RESPONSE');
  const prices = [FAL_IMAGE_MODEL, FAL_TEXT_IMAGE_MODEL].map(endpointId => {
    const price = (payload as any).prices.find((entry: any) => entry?.endpoint_id === endpointId);
    if (!price || price.currency !== 'USD' || typeof price.unit !== 'string' ||
        !Number.isFinite(price.unit_price) || price.unit_price <= 0) throw Error('FAL_PRICING_MODEL_NOT_VERIFIED');
    return { endpointId, unit: price.unit as string, unitPriceUsd: price.unit_price as number, currency: 'USD' as const };
  });
  return { models: prices };
}
