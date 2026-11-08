/**
 * Validates a request-level billing line item from fal Platform APIs.
 * This module does not estimate or invent a charge. Callers must fetch
 * an authoritative request-level record before settling as succeeded.
 */
export type FalCharge = { requestId: string; endpointId: string; billedUsd: number };
export function reconcileFalCharge(input: {
  record: unknown;
  expectedRequestId: string;
  expectedEndpointId: string;
  maximumUsd: number;
}): FalCharge {
  const { record, expectedRequestId, expectedEndpointId, maximumUsd } = input;
  if (!record || typeof record !== 'object' || Array.isArray(record)) throw Error('FAL_BILLING_RECORD_INVALID');
  const r = record as Record<string, unknown>;
  if (typeof r.request_id !== 'string' || r.request_id !== expectedRequestId) throw Error('FAL_BILLING_REQUEST_MISMATCH');
  if (typeof r.endpoint_id !== 'string' || r.endpoint_id !== expectedEndpointId) throw Error('FAL_BILLING_MODEL_MISMATCH');
  if (r.currency !== 'USD') throw Error('FAL_BILLING_CURRENCY_MISMATCH');
  if (typeof r.cost !== 'number' || !Number.isFinite(r.cost) || r.cost < 0) throw Error('FAL_BILLING_COST_INVALID');
  if (!Number.isFinite(maximumUsd) || maximumUsd <= 0 || r.cost > maximumUsd) throw Error('FAL_BILLING_EXCEEDS_RESERVATION');
  return { requestId: r.request_id, endpointId: r.endpoint_id, billedUsd: r.cost };
}
