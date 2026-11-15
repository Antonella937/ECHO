import { pool } from "@workspace/db";
import { fetchMpPaymentEvidence, validateMpPaymentEvidence } from "./mercadopagoPaymentEvidence";

/**
 * Store provider-confirmed evidence for an existing server-created subscription
 * intent. Never activates an entitlement; a separately verified billing period
 * and a trusted reconciliation job are still required.
 */
export async function recordVerifiedMpSubscriptionPayment(paymentId: string): Promise<
  { recorded: true; duplicate: boolean } | { recorded: false; reason: string }
> {
  const payment = await fetchMpPaymentEvidence(paymentId);
  if (!payment.externalReference) return { recorded: false, reason: "MISSING_REFERENCE" };

  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    const found = await client.query(
      `SELECT owner_id,reference,amount_ars,currency,provider_preapproval_id
       FROM echo_mp_subscription_intents WHERE reference=$1 FOR UPDATE`,
      [payment.externalReference],
    );
    const intent = found.rows[0];
    if (!intent || !intent.provider_preapproval_id || intent.currency !== "ARS") {
      await client.query("ROLLBACK");
      return { recorded: false, reason: "UNLINKED_SUBSCRIPTION_INTENT" };
    }
    // A matching external reference is insufficient to prove this installment
    // belongs to the preapproval. Require an explicit provider subscription ID.
    if (payment.subscriptionId !== intent.provider_preapproval_id) {
      await client.query("ROLLBACK");
      return { recorded: false, reason: "SUBSCRIPTION_PAYMENT_BINDING_MISMATCH" };
    }
    const evidence = validateMpPaymentEvidence({
      payment, reference: intent.reference, amountArs: Number(intent.amount_ars),
    });
    if (!evidence.accepted) {
      await client.query("ROLLBACK");
      return { recorded: false, reason: evidence.reason };
    }
    const inserted = await client.query(
      `INSERT INTO echo_mp_payment_receipts
        (provider_payment_id,owner_id,reference,purchase_kind,provider_preapproval_id,
         amount_ars,currency,provider_status,paid_at)
       VALUES ($1,$2,$3,'subscription',$4,$5,'ARS','approved',$6)
       ON CONFLICT (provider_payment_id) DO NOTHING
       RETURNING provider_payment_id`,
      [evidence.paymentId,intent.owner_id,intent.reference,intent.provider_preapproval_id,
        intent.amount_ars,evidence.paidAt],
    );
    if (inserted.rowCount === 0) {
      // An existing payment ID might belong to another owner or reference.
      // Never report it as a harmless duplicate without checking its binding.
      const existing = await client.query(
        `SELECT owner_id,reference,purchase_kind,provider_preapproval_id,amount_ars,currency
         FROM echo_mp_payment_receipts WHERE provider_payment_id=$1`,
        [evidence.paymentId],
      );
      const row = existing.rows[0];
      const same = row && row.owner_id === intent.owner_id &&
        row.reference === intent.reference && row.purchase_kind === "subscription" &&
        row.provider_preapproval_id === intent.provider_preapproval_id &&
        row.currency === "ARS" && Number(row.amount_ars) === Number(intent.amount_ars);
      if (!same) {
        await client.query("ROLLBACK");
        return { recorded: false, reason: "PAYMENT_ALREADY_BOUND_ELSEWHERE" };
      }
    }
    await client.query("COMMIT");
    return { recorded: true, duplicate: inserted.rowCount === 0 };
  } catch (error) {
    await client.query("ROLLBACK");
    throw error;
  } finally {
    client.release();
  }
}
