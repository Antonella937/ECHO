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

/** Reversed payments cannot regain approved status from an out-of-order callback. */
export function reconcileMpPaymentStatus(
  current: "approved" | "pending" | "rejected" | "refunded" | "charged_back" | "unknown",
  observed: "approved" | "pending" | "rejected" | "refunded" | "charged_back" | "unknown",
): typeof current {
  if (current === "charged_back") return current;
  if (current === "refunded") return observed === "charged_back" ? "charged_back" : current;
  return observed;
}

/**
 * A provider preapproval's next_payment_date is NOT proof of a paid-through
 * entitlement. A paid period must be derived from a separately verified
 * installment and its actual billing interval.
 */
export function validateMpPaidPeriod(input: {
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
  providerPaymentApproved: boolean;
}, now: Date = new Date()): { valid: boolean; reason: string } {
  if (!input.providerPaymentApproved) return { valid: false, reason: "PAYMENT_NOT_APPROVED" };
  const { paidAt, periodStart, periodEnd } = input;
  if (!(paidAt instanceof Date) || !(periodStart instanceof Date) || !(periodEnd instanceof Date) ||
      ![paidAt, periodStart, periodEnd].every(d => Number.isFinite(d.getTime())))
    return { valid: false, reason: "MISSING_VERIFIED_PERIOD" };
  if (periodStart.getTime() > paidAt.getTime() || paidAt.getTime() > periodEnd.getTime())
    return { valid: false, reason: "PAYMENT_OUTSIDE_PERIOD" };
  if (periodEnd.getTime() <= now.getTime())
    return { valid: false, reason: "PERIOD_EXPIRED" };
  // Refuse unreasonable periods until the subscription's billing interval is reconciled.
  if (periodEnd.getTime() - periodStart.getTime() > 35 * 24 * 60 * 60 * 1000)
    return { valid: false, reason: "PERIOD_EXCEEDS_MONTHLY_INTERVAL" };
  return { valid: true, reason: "VERIFIED_PERIOD" };
}

/**
 * Plan for a membership mutation, but do not execute one.
 * The caller must prove the installment, its ownership and paid period first.
 */
export function planMpMembershipReconciliation(input: {
  plan: "plus" | "premium";
  subscriptionStatus: MpSubscriptionStatus;
  providerPreapprovalId: string;
  expectedAmountArs: number;
  payment: {
    status: "approved" | "pending" | "rejected" | "refunded" | "charged_back" | "unknown";
    subscriptionId: string | null;
    amountArs: number | null;
    currency: string | null;
  };
  paidAt: Date | null;
  periodStart: Date | null;
  periodEnd: Date | null;
}, now: Date = new Date()): {
  action: "eligible_for_activation" | "hold";
  plan: "plus" | "premium" | null;
  periodEnd: Date | null;
  reason: string;
} {
  const payment = evaluateMpSandboxPayment({
    subscriptionStatus: input.subscriptionStatus,
    providerPreapprovalId: input.providerPreapprovalId,
    expectedAmountArs: input.expectedAmountArs,
    payment: input.payment,
    periodEnd: input.periodEnd,
  }, now);
  if (!payment.eligible) return { action: "hold", plan: null, periodEnd: null, reason: payment.reason };
  const period = validateMpPaidPeriod({
    paidAt: input.paidAt,
    periodStart: input.periodStart,
    periodEnd: input.periodEnd,
    providerPaymentApproved: input.payment.status === "approved",
  }, now);
  if (!period.valid) return { action: "hold", plan: null, periodEnd: null, reason: period.reason };
  return { action: "eligible_for_activation", plan: input.plan, periodEnd: input.periodEnd, reason: "VERIFIED_PAYMENT_AND_PERIOD" };
}
