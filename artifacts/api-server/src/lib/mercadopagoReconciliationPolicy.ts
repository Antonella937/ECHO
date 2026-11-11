/**
 * Subscription state machine for Mercado Pago sandbox.
 * A preapproval authorization is NOT proof of a collected installment.
 * Never grant paid ECHO access solely from a preapproval notification.
 */
export type MpSubscriptionStatus = "draft" | "pending" | "authorized" | "paused" | "canceled" | "failed";
export type MpProviderStatus = "pending" | "authorized" | "paused" | "cancelled" | "unknown";

export function nextMpSubscriptionStatus(current: MpSubscriptionStatus, provider: MpProviderStatus): MpSubscriptionStatus {
  if (current === "canceled" || current === "failed") return current;
  switch (provider) {
    case "pending": return current === "draft" ? "pending" : current;
    case "authorized": return "authorized";
    case "paused": return "paused";
    case "cancelled": return "canceled";
    case "unknown": return current;
  }
}

/** Paid access requires an independently verified, captured payment and a bounded entitlement period. */
export function canActivatePaidMembership(input: {
  subscriptionStatus: MpSubscriptionStatus;
  paymentStatus: "approved" | "pending" | "rejected" | "refunded" | "charged_back" | "unknown";
  paymentVerifiedFromProvider: boolean;
  paymentMatchesSubscription: boolean;
  periodEnd: Date | null;
}, now: Date = new Date()): boolean {
  return input.subscriptionStatus === "authorized" &&
    input.paymentStatus === "approved" &&
    input.paymentVerifiedFromProvider &&
    input.paymentMatchesSubscription &&
    input.periodEnd instanceof Date &&
    Number.isFinite(input.periodEnd.getTime()) &&
    input.periodEnd.getTime() > now.getTime();
}

/**
 * Read-only payment evidence decision. No membership mutation is performed.
 * Provider payment must identify the exact preapproval and billed amount.
 */
export function evaluateMpSandboxPayment(input: {
  subscriptionStatus: MpSubscriptionStatus;
  providerPreapprovalId: string;
  expectedAmountArs: number;
  payment: {
    status: "approved" | "pending" | "rejected" | "refunded" | "charged_back" | "unknown";
    subscriptionId: string | null;
    amountArs: number | null;
    currency: string | null;
  };
  periodEnd: Date | null;
}, now: Date = new Date()): { eligible: boolean; reason: string } {
  if (!input.providerPreapprovalId || !Number.isFinite(input.expectedAmountArs) ||
      input.expectedAmountArs <= 0) return { eligible: false, reason: "INVALID_SUBSCRIPTION" };
  if (input.payment.subscriptionId !== input.providerPreapprovalId)
    return { eligible: false, reason: "SUBSCRIPTION_MISMATCH" };
  if (input.payment.currency !== "ARS" || input.payment.amountArs === null ||
      !Number.isFinite(input.payment.amountArs) ||
      Math.abs(input.payment.amountArs - input.expectedAmountArs) > 0.001)
    return { eligible: false, reason: "PAYMENT_AMOUNT_MISMATCH" };
  if (input.payment.status !== "approved")
    return { eligible: false, reason: "PAYMENT_NOT_APPROVED" };
  const eligible = canActivatePaidMembership({
    subscriptionStatus: input.subscriptionStatus,
    paymentStatus: input.payment.status,
    paymentVerifiedFromProvider: true,
    paymentMatchesSubscription: true,
    periodEnd: input.periodEnd,
  }, now);
  return { eligible, reason: eligible ? "VERIFIED_APPROVED_PAYMENT" : "SUBSCRIPTION_OR_PERIOD_NOT_ELIGIBLE" };
}
