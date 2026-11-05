/**
 * Independent safety gates for paid image generation.
 * Never infer authorization from the presence of an API key.
 */
export function paidImageGenerationActivated(env: {
  ECHO_PAID_IMAGE_GENERATION_ENABLED?: string;
  ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED?: string;
} = process.env): boolean {
  return env.ECHO_PAID_IMAGE_GENERATION_ENABLED === 'true' &&
    env.ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED === 'true';
}
