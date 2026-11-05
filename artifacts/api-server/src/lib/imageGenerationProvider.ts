/**
 * Paid image-provider boundary.
 *
 * This module intentionally does not make network requests. It defines the
 * provider payload contract so it can be tested without an API key or credits.
 * Never pass private /objects paths directly to a third-party provider.
 */
export type ImageGenerationStyle = 'natural' | 'phone' | 'analog' | 'editorial' | 'cinematic';
export interface ImageGenerationRequest {
  prompt: string;
  style: ImageGenerationStyle;
  characterId: string;
  /** Owner-verified private media paths, NOT externally accessible URLs. */
  referencePaths: string[];
}
export interface ImageGenerationResult {
  bytes: Buffer;
  mimeType: 'image/png' | 'image/jpeg' | 'image/webp';
  provider: string;
  model: string;
  billedUsd: number;
}
export const IMAGE_GENERATION_MODEL = 'qwen/qwen-image-2.1-turbo';
export const MAX_IMAGE_REFERENCE_COUNT = 4;
export const MAX_IMAGE_COST_USD = 0.10;
// Paid generation remains disabled until provider validation and owner approval.

/** Conservative status: no API key or feature flag alone proves that a production budget is active. */
export function imageGenerationAvailability() {
  return {
    enabled: false as const,
    reason: 'PAID_IMAGE_GENERATION_DISABLED' as const,
    model: IMAGE_GENERATION_MODEL,
    maximumReferences: MAX_IMAGE_REFERENCE_COUNT,
    monthlySpendingLimitUsd: 0,
    paidCallsMade: 0,
    prerequisites: {
      openRouterKeyConfigured: Boolean(process.env.OPENROUTER_API_KEY),
      privateStorageConfigured: Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY),
      providerValidated: process.env.ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED === 'true',
      paidFeatureFlagEnabled: process.env.ECHO_PAID_IMAGE_GENERATION_ENABLED === 'true',
      ownerAllowlistConfigured: Boolean(process.env.ECHO_IMAGE_GENERATION_ALLOWED_USER_IDS?.trim()),
      budgetActivated: false,
    },
  };
}

export async function generatePaidImage(_request: ImageGenerationRequest): Promise<ImageGenerationResult> {
  // A process-local counter cannot enforce a monthly spending limit across
  // Render instances/restarts. Do not enable requests without a DB-backed,
  // atomic reservation/settlement ledger and explicit owner consent.
  throw new Error('PAID_IMAGE_GENERATION_DISABLED');
}
