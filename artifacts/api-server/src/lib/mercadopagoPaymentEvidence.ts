/** Fail-closed validation for payment evidence obtained from Mercado Pago's API. */
export type VerifiedMpPayment = {
  id: string;
  status: string;
  externalReference: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  dateApproved: string | null;
};
export function validateMpPaymentEvidence(input: {
  payment: VerifiedMpPayment;
  reference: string;
  amountArs: number;
}): { accepted: true; paymentId: string; paidAt: Date } | { accepted: false; reason: string } {
  const { payment, reference, amountArs } = input;
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(payment.id)) return { accepted: false, reason: "INVALID_PAYMENT_ID" };
  if (payment.externalReference !== reference) return { accepted: false, reason: "REFERENCE_MISMATCH" };
  if (payment.status !== "approved") return { accepted: false, reason: "NOT_APPROVED" };
  if (payment.currencyId !== "ARS") return { accepted: false, reason: "CURRENCY_MISMATCH" };
  if (payment.transactionAmount === null || !Number.isFinite(payment.transactionAmount) ||
      !Number.isFinite(amountArs) || Math.abs(payment.transactionAmount - amountArs) > 0.001) {
    return { accepted: false, reason: "AMOUNT_MISMATCH" };
  }
  if (!payment.dateApproved) return { accepted: false, reason: "MISSING_APPROVAL_DATE" };
  const paidAt = new Date(payment.dateApproved);
  if (!Number.isFinite(paidAt.getTime()) || paidAt.getTime() > Date.now() + 300000) {
    return { accepted: false, reason: "INVALID_APPROVAL_DATE" };
  }
  return { accepted: true, paymentId: payment.id, paidAt };
}
