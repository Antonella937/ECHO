/** Read-only price verification. Never makes a billable inference request. */
export async function fetchFalModelPrice(input: { apiKey: string; endpointId: string; fetchImpl?: typeof fetch }): Promise<{ unit: string; unitPriceUsd: number }> {
  if (!input.apiKey.trim()) throw Error('FAL_KEY_MISSING');
  if (!/^fal-ai\/[a-z0-9][a-z0-9/_-]*$/.test(input.endpointId)) throw Error('INVALID_FAL_ENDPOINT');
  const url = new URL('https://api.fal.ai/v1/models/pricing');
  url.searchParams.set('endpoint_id', input.endpointId);
  const response = await (input.fetchImpl ?? fetch)(url, {
    headers: { Authorization: `Key ${input.apiKey}`, Accept: 'application/json' },
    redirect: 'error',
    signal: AbortSignal.timeout(10000),
  });
  if (!response.ok) throw Error(`FAL_PRICING_HTTP_${response.status}`);
  const body: unknown = await response.json();
  if (!body || typeof body !== 'object' || !('prices' in body) || !Array.isArray(body.prices)) throw Error('FAL_PRICING_INVALID_RESPONSE');
  const matching = body.prices.filter((price: unknown) =>
    !!price && typeof price === 'object' && 'endpoint_id' in price && price.endpoint_id === input.endpointId
  );
  if (matching.length !== 1) throw Error('FAL_PRICING_NOT_UNIQUE');
  const price = matching[0] as Record<string, unknown>;
  if (price.currency !== 'USD' || typeof price.unit !== 'string' ||
      typeof price.unit_price !== 'number' || !Number.isFinite(price.unit_price) || price.unit_price <= 0) {
    throw Error('FAL_PRICING_UNSUPPORTED');
  }
  return { unit: price.unit, unitPriceUsd: price.unit_price };
}
