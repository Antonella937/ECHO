import { test } from 'node:test';
import { strict as assert } from 'node:assert';
import { reconcileFalCharge } from '../src/lib/falCostReconciliation';

const record = { request_id: 'request_12345678', endpoint_id: 'fal-ai/flux-2-pro/edit', currency: 'USD', cost: 0.09 };
const input = { expectedRequestId: record.request_id, expectedEndpointId: record.endpoint_id, maximumUsd: 0.2 };

test('accepts an exact verified request charge', () => {
  assert.deepEqual(reconcileFalCharge({ ...input, record }), {
    requestId: record.request_id, endpointId: record.endpoint_id, billedUsd: 0.09,
  });
});
test('rejects charges from another request or model', () => {
  assert.throws(() => reconcileFalCharge({ ...input, record: { ...record, request_id: 'other' } }), /REQUEST_MISMATCH/);
  assert.throws(() => reconcileFalCharge({ ...input, record: { ...record, endpoint_id: 'other' } }), /MODEL_MISMATCH/);
});
test('rejects non-USD, invalid, missing or excessive costs', () => {
  for (const changed of [{ currency: 'EUR' }, { cost: NaN }, { cost: -1 }, { cost: 0.21 }, { cost: undefined }]) {
    assert.throws(() => reconcileFalCharge({ ...input, record: { ...record, ...changed } }));
  }
});
