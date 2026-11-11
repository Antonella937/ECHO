/**
 * Mercado Pago subscriptions API adapter.
 * No payment operations are exposed until signed webhooks, reconciliation,
 * and end-to-end sandbox tests are complete.
 */
export type MpPreapprovalStatus =
  | "pending" | "authorized" | "paused" | "cancelled" | "unknown";

export interface MpPreapproval {
  id: string;
  status: MpPreapprovalStatus;
  externalReference: string | null;
  payerEmail: string | null;
  nextPaymentDate: string | null;
  amountArs: number | null;
}

const MP_API = "https://api.mercadopago.com";
const TIMEOUT_MS = 8000;

function testToken(): string {
  const token = process.env.ECHO_MP_ACCESS_TOKEN;
  if (!token || !/^TEST-[A-Za-z0-9_-]+$/.test(token)) {
    throw new Error("MP_TEST_CREDENTIALS_UNAVAILABLE");
  }
  return token;
}

function safeId(id: string): string {
  if (!/^[A-Za-z0-9_-]{1,128}$/.test(id)) throw new Error("INVALID_MP_RESOURCE_ID");
  return id;
}

function normalizePreapproval(input: unknown): MpPreapproval {
  if (!input || typeof input !== "object") throw new Error("INVALID_MP_RESPONSE");
  const data = input as Record<string, unknown>;
  if (typeof data.id !== "string" && typeof data.id !== "number") throw new Error("INVALID_MP_RESPONSE");
  const status = data.status;
  const valid = ["pending", "authorized", "paused", "cancelled"];
  const amount = data.auto_recurring && typeof data.auto_recurring === "object"
    ? (data.auto_recurring as Record<string, unknown>).transaction_amount : null;
  return {
    id: String(data.id),
    status: typeof status === "string" && valid.includes(status) ? status as MpPreapprovalStatus : "unknown",
    externalReference: typeof data.external_reference === "string" ? data.external_reference : null,
    payerEmail: typeof data.payer_email === "string" ? data.payer_email : null,
    nextPaymentDate: typeof data.next_payment_date === "string" ? data.next_payment_date : null,
    amountArs: typeof amount === "number" && Number.isFinite(amount) && amount > 0 ? amount : null,
  };
}

/** Provider-authoritative read. Never trust status supplied by a browser or webhook body. */
export async function fetchMpPreapproval(id: string): Promise<MpPreapproval> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), TIMEOUT_MS);
  try {
    const response = await fetch(`${MP_API}/preapproval/${encodeURIComponent(safeId(id))}`, {
      method: "GET",
      headers: { Authorization: `Bearer ${testToken()}`, Accept: "application/json" },
      signal: controller.signal,
    });
    if (!response.ok) throw new Error(`MP_PROVIDER_HTTP_${response.status}`);
    return normalizePreapproval(await response.json());
  } finally {
    clearTimeout(timeout);
  }
}

/**
 * Produces an immutable request payload for a future preapproval POST.
 * It deliberately does NOT call Mercado Pago or generate a checkout URL.
 */
export function buildMpPreapprovalPayload(input: {
  reference: string;
  plan: "plus" | "premium";
  amountArs: number;
  payerEmail: string;
  backUrl: string;
}) {
  if (!/^echo:(plus|premium):[a-f0-9-]{36}$/.test(input.reference)) throw new Error("INVALID_MP_REFERENCE");
  if (!Number.isFinite(input.amountArs) || input.amountArs <= 0) throw new Error("INVALID_MP_AMOUNT");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(input.payerEmail)) throw new Error("INVALID_MP_PAYER_EMAIL");
  const url = new URL(input.backUrl);
  if (url.protocol !== "https:") throw new Error("INVALID_MP_BACK_URL");
  return {
    reason: `ECHO ${input.plan === "plus" ? "Plus" : "Premium"}`,
    external_reference: input.reference,
    payer_email: input.payerEmail,
    back_url: url.toString(),
    auto_recurring: {
      frequency: 1,
      frequency_type: "months",
      transaction_amount: input.amountArs,
      currency_id: "ARS",
    },
  };
}
