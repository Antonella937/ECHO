import { paidImageGenerationActivated } from './imageGenerationActivation';
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
export const IMAGE_GENERATION_MODEL = 'fal-ai/flux-2-pro/edit';
export const MAX_IMAGE_REFERENCE_COUNT = 4;
// Conservative reservation for multi-reference image generation.
// Actual price must be computed from image dimensions before activation.
export const MAX_IMAGE_COST_USD = 0.20;
// Paid generation remains disabled until provider validation and owner approval.

/** Conservative status: no API key or feature flag alone proves that a production budget is active. */
export function imageGenerationAvailability() {
  return {
    enabled: paidImageGenerationActivated() && Boolean(process.env.FAL_KEY) && Boolean(process.env.SUPABASE_URL && process.env.SUPABASE_SERVICE_ROLE_KEY) && Boolean(process.env.ECHO_IMAGE_GENERATION_ALLOWED_USER_IDS?.trim()),
    reason: paidImageGenerationActivated() ? 'BUDGET_AND_ACCOUNT_CHECK_REQUIRED' : 'PAID_IMAGE_GENERATION_DISABLED',
    // Model capability verified against public docs; production contract and
    // per-account data-transfer consent still require separate approval.
    providerDocumentationChecked: true as const,
    externalReferenceTransferApproved: false as const, // Per-request acknowledgement required; never blanket approval.
    model: IMAGE_GENERATION_MODEL,
    maximumReferences: MAX_IMAGE_REFERENCE_COUNT,
    monthlySpendingLimitUsd: 0,
    paidCallsMade: 0,
    prerequisites: {
      falKeyConfigured: Boolean(process.env.FAL_KEY),
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
