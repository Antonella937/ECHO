import assert from 'node:assert/strict';
import { test } from 'node:test';
import { paidImageGenerationActivated } from '../src/lib/imageGenerationActivation';

test('paid generation is disabled unless both independent gates are explicitly true', () => {
  assert.equal(paidImageGenerationActivated({}), false);
  assert.equal(paidImageGenerationActivated({ ECHO_PAID_IMAGE_GENERATION_ENABLED: 'true' }), false);
  assert.equal(paidImageGenerationActivated({ ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED: 'true' }), false);
  assert.equal(paidImageGenerationActivated({ ECHO_PAID_IMAGE_GENERATION_ENABLED: 'TRUE', ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED: 'true' }), false);
  assert.equal(paidImageGenerationActivated({ ECHO_PAID_IMAGE_GENERATION_ENABLED: 'true', ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED: 'true' }), true);
});
