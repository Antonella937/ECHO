/**
 * Pure subscription reconciliation policy. This module never grants access or
 * writes to the database. A verified provider read, matched to a persisted
 * checkout intent, is required before any caller may apply a transition.
 */
import type { MpPreapproval } from "./mercadopagoSubscriptions";

export type ReconciliationDecision =
  | { action: "ignore"; reason: string }
  | { action: "pending"; reference: string; providerId: string }
  | { action: "activate"; reference: string; providerId: string }
  | { action: "suspend"; reference: string; providerId: string };

export function decideMpSubscriptionTransition(input: {
  intent: { reference: string; providerPreapprovalId: string | null; amountArs: number };
  provider: MpPreapproval;
}): ReconciliationDecision {
  const { intent, provider } = input;
  if (!intent.providerPreapprovalId || provider.id !== intent.providerPreapprovalId) {
    return { action: "ignore", reason: "PROVIDER_ID_MISMATCH" };
  }
  if (provider.externalReference !== intent.reference) {
    return { action: "ignore", reason: "REFERENCE_MISMATCH" };
  }
  if (provider.amountArs === null || !Number.isFinite(provider.amountArs) ||
      Math.abs(provider.amountArs - intent.amountArs) > 0.001) {
    return { action: "ignore", reason: "AMOUNT_MISMATCH" };
  }
  if (provider.status === "authorized") {
    // Authorization alone is NOT evidence of a successfully collected installment.
    // The payment collection must be independently verified before granting access.
    return { action: "pending", reference: intent.reference, providerId: provider.id };
  }
  if (provider.status === "pending") {
    return { action: "pending", reference: intent.reference, providerId: provider.id };
  }
  if (provider.status === "paused" || provider.status === "cancelled") {
    // Do not revoke an already-paid period without verifying its end date.
    return { action: "suspend", reference: intent.reference, providerId: provider.id };
  }
  return { action: "ignore", reason: "UNKNOWN_STATUS" };
}
