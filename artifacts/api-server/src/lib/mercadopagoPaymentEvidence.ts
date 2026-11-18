/** Fail-closed validation for payment evidence obtained from Mercado Pago's API. */
export type VerifiedMpPayment = {
  id: string;
  status: string;
  externalReference: string | null;
  transactionAmount: number | null;
  currencyId: string | null;
  dateApproved: string | null;
  subscriptionId?: string | null;
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


const MP_PAYMENT_API = "https://api.mercadopago.com";
const MP_PAYMENT_TIMEOUT_MS = 8000;

/**
 * Fetches payment evidence from the provider, not from client or webhook body.
 * Test credentials only. The caller must independently match the verified
 * payment to an existing server-created intent and subscription.
 */
export async function fetchMpPaymentEvidence(id: string): Promise<VerifiedMpPayment> {
  if (!/^[0-9]{1,30}$/.test(id)) throw new Error("INVALID_MP_PAYMENT_ID");
  const token = process.env.ECHO_MP_ACCESS_TOKEN;
  if (!token || !/^TEST-[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("MP_TEST_CREDENTIALS_UNAVAILABLE");
  }
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), MP_PAYMENT_TIMEOUT_MS);
  try {
    const response = await fetch(`${MP_PAYMENT_API}/v1/payments/${id}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${token}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MP_PAYMENT_PROVIDER_HTTP_${response.status}`);
    const data: unknown = await response.json();
    if (!data || typeof data !== "object") throw new Error("INVALID_MP_PAYMENT_RESPONSE");
    const record = data as Record<string, unknown>;
    if (normalizeMpPaymentResourceId(record.id) !== id) throw new Error("MP_PAYMENT_ID_MISMATCH");
    return {
      id,
      status: typeof record.status === "string" ? record.status : "unknown",
      externalReference: typeof record.external_reference === "string" ? record.external_reference : null,
      transactionAmount: typeof record.transaction_amount === "number" ? record.transaction_amount : null,
      currencyId: typeof record.currency_id === "string" ? record.currency_id : null,
      dateApproved: typeof record.date_approved === "string" ? record.date_approved : null,
      // Fail closed if the payment response does not explicitly identify its subscription.
      subscriptionId: typeof record.preapproval_id === "string" ? record.preapproval_id : null,
    };
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Conservative subscription binding check. A matching external reference
 * alone is insufficient to attribute a payment to a recurring preapproval.
 */
export function validateMpSubscriptionBinding(payment: VerifiedMpPayment, preapprovalId: string):
  { accepted: true } | { accepted: false; reason: string } {
  if (!preapprovalId || !payment.subscriptionId) {
    return { accepted: false, reason: "MISSING_SUBSCRIPTION_BINDING" };
  }
  if (payment.subscriptionId !== preapprovalId) {
    return { accepted: false, reason: "SUBSCRIPTION_PAYMENT_BINDING_MISMATCH" };
  }
  return { accepted: true };
}

/**
 * Provider webhook resource IDs may arrive as JSON numbers. Normalize only
 * decimal identifiers without coercing arbitrary objects or strings.
 */
export function normalizeMpPaymentResourceId(value: unknown): string | null {
  if (typeof value === "string" && /^[0-9]{1,30}$/.test(value)) return value;
  if (typeof value === "number" && Number.isSafeInteger(value) && value >= 0) return String(value);
  return null;
}
