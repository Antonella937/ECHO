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
