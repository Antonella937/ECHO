import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { createMpSandboxPreapproval, fetchMpSandboxPayment } from "../lib/mercadopagoSubscriptions";

/**
 * Mercado Pago subscription preflight.
 * This route never returns credentials, creates a charge, or grants access.
 * Checkout must remain disabled until signed notifications and a durable
 * subscription reconciliation flow have been implemented and tested.
 */
const router: IRouter = Router();

const parseArsAmount = (value: string | undefined): number | null => {
  if (!value || !/^[1-9]\d{0,8}(?:\.\d{1,2})?$/.test(value)) return null;
  const amount = Number(value);
  return Number.isFinite(amount) && amount > 0 ? amount : null;
};

const isTestCredential = (token: string | undefined): boolean =>
  Boolean(token && /^TEST-/i.test(token));

router.get("/billing/mercadopago/config", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const accessToken = process.env.ECHO_MP_ACCESS_TOKEN;
  const configured = isTestCredential(accessToken);
  const plusArs = parseArsAmount(process.env.ECHO_MP_PLUS_ARS);
  const premiumArs = parseArsAmount(process.env.ECHO_MP_PREMIUM_ARS);
  res.json({
    provider: "mercadopago",
    environment: "test",
    ready: false,
    checkoutEnabled: false,
    billingExempt: lifetimeAccessForOwner(req.userId!) !== null,
    currency: "ARS",
    supportedPlans: ["plus", "premium"],
    // USD catalog prices are NOT charged as if they were ARS.
    // Prices are server-configured only after choosing local ARS amounts.
    pricing: { currency: "ARS", plus: plusArs, premium: premiumArs },
    setup: {
      testAccessToken: configured,
      webhookSecret: Boolean(process.env.ECHO_MP_WEBHOOK_SECRET),
      callbackUrl: Boolean(process.env.ECHO_MP_CALLBACK_URL),
      plusArsConfigured: plusArs !== null,
      premiumArsConfigured: premiumArs !== null,
      verifiedNotifications: false,
      subscriptionReconciliation: false,
    },
    note: "No payments or subscription activations are enabled.",
  });
});

/**
 * Server-created subscription draft only. It never charges or grants access.
 * An actual Mercado Pago preapproval is created only after test credentials,
 * verified callbacks and idempotent reconciliation are in place.
 */
router.post("/billing/mercadopago/subscription-draft", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (lifetimeAccessForOwner(req.userId!) !== null) {
    res.status(409).json({ error: "BILLING_EXEMPT" });
    return;
  }
  const plan = req.body?.plan;
  if (plan !== "plus" && plan !== "premium") {
    res.status(400).json({ error: "INVALID_PLAN" });
    return;
  }
  const amount = parseArsAmount(process.env[plan === "plus" ? "ECHO_MP_PLUS_ARS" : "ECHO_MP_PREMIUM_ARS"]);
  if (amount === null) {
    res.status(503).json({ error: "ARS_PRICE_NOT_CONFIGURED" });
    return;
  }
  const reference = `echo:${plan}:${randomUUID()}`;
  try {
    await pool.query(
      `INSERT INTO echo_mp_subscription_intents(reference,owner_id,plan,amount_ars)
       VALUES($1,$2,$3,$4)`,
      [reference, req.userId!, plan, amount],
    );
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP draft persistence failed");
    res.status(503).json({ error: "SUBSCRIPTION_DRAFT_UNAVAILABLE" });
    return;
  }
  res.status(202).json({
    status: "draft_only",
    checkoutEnabled: false,
    provider: "mercadopago",
    plan,
    reference,
    frequency: 1,
    frequencyType: "months",
    currency: "ARS",
    amount,
    checkoutUrl: null,
  });
});


/**
 * Explicitly gated sandbox-only checkout. Uses an existing server-created draft.
 * No entitlement is granted here, even if the provider says "authorized".
 */
router.post("/billing/mercadopago/sandbox-checkout", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED !== "true") {
    res.status(503).json({ error: "MP_SANDBOX_CHECKOUT_DISABLED" }); return;
  }
  if (lifetimeAccessForOwner(req.userId!) !== null) {
    res.status(409).json({ error: "BILLING_EXEMPT" }); return;
  }
  const reference = req.body?.reference;
  const payerEmail = req.body?.payerEmail;
  const backUrl = process.env.ECHO_MP_CALLBACK_URL;
  if (typeof reference !== "string" || !/^echo:(plus|premium):[a-f0-9-]{36}$/.test(reference) ||
      typeof payerEmail !== "string" || payerEmail.length > 254 ||
      !/^[^\\s@]+@[^\\s@]+\\.[^\\s@]+$/.test(payerEmail) || !backUrl) {
    res.status(400).json({ error: "INVALID_SANDBOX_CHECKOUT" }); return;
  }
  // The callback URL and ARS price are server-controlled; the browser cannot override either.
  const client = await pool.connect().catch(() => null);
  if (!client) { res.status(503).json({ error: "MP_DATABASE_UNAVAILABLE" }); return; }
  let transactionOpen = false;
  try {
    await client.query("BEGIN"); transactionOpen = true;
    const rows = await client.query<{ plan: "plus" | "premium"; amount_ars: string; provider_preapproval_id: string | null; status: string }>(
      `SELECT plan,amount_ars,provider_preapproval_id,status FROM echo_mp_subscription_intents
       WHERE reference=$1 AND owner_id=$2 FOR UPDATE`, [reference, req.userId!]);
    const draft = rows.rows[0];
    if (!draft) {
      await client.query("ROLLBACK"); transactionOpen = false;
      res.status(404).json({ error: "MP_DRAFT_NOT_FOUND" }); return;
    }
    if (draft.provider_preapproval_id || draft.status !== "draft") {
      await client.query("ROLLBACK"); transactionOpen = false;
      res.status(409).json({ error: "MP_DRAFT_ALREADY_SUBMITTED" }); return;
    }
    const amountArs = parseArsAmount(process.env[draft.plan === "plus" ? "ECHO_MP_PLUS_ARS" : "ECHO_MP_PREMIUM_ARS"]);
    if (amountArs === null || Math.abs(amountArs - Number(draft.amount_ars)) > 0.001) {
      await client.query("ROLLBACK"); transactionOpen = false;
      res.status(409).json({ error: "MP_PRICE_CHANGED" }); return;
    }
    const checkout = await createMpSandboxPreapproval({
      reference, plan: draft.plan, amountArs, payerEmail, backUrl,
    }, { sandboxEnabled: true });
    await client.query(
      `UPDATE echo_mp_subscription_intents
       SET provider_preapproval_id=$3,status=$4,updated_at=now()
       WHERE reference=$1 AND owner_id=$2`,
      [reference, req.userId!, checkout.id, checkout.status],
    );
    await client.query("COMMIT"); transactionOpen = false;
    res.status(201).json({ provider: "mercadopago", environment: "test",
      reference, checkoutUrl: checkout.checkoutUrl, status: checkout.status,
      entitlementChanged: false });
  } catch (error) {
    if (transactionOpen) await client.query("ROLLBACK").catch(() => {});
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP sandbox checkout unavailable");
    res.status(503).json({ error: "MP_SANDBOX_CHECKOUT_UNAVAILABLE" });
  } finally {
    client.release();
  }
});

router.get("/billing/mercadopago/subscription-drafts", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const result = await pool.query(
      `SELECT reference,plan,currency,amount_ars,status,created_at
       FROM echo_mp_subscription_intents WHERE owner_id=$1
       ORDER BY created_at DESC LIMIT 20`, [req.userId!]);
    res.json({ drafts: result.rows, checkoutEnabled: false });
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP draft listing failed");
    res.status(503).json({ error: "SUBSCRIPTION_DRAFTS_UNAVAILABLE" });
  }
});


/** Read-only status for the authenticated owner; never claims a payment was collected. */
router.get("/billing/mercadopago/subscription-status/:reference", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const reference = req.params.reference;
  if (typeof reference !== "string" || !/^echo:(plus|premium):[a-f0-9-]{36}$/.test(reference)) {
    res.status(400).json({ error: "INVALID_MP_REFERENCE" }); return;
  }
  try {
    const result = await pool.query<{
      reference: string; plan: string; status: string; currency: string;
      amount_ars: string; provider_preapproval_id: string | null;
    }>(
      `SELECT reference,plan,status,currency,amount_ars,provider_preapproval_id
       FROM echo_mp_subscription_intents WHERE reference=$1 AND owner_id=$2 LIMIT 1`,
      [reference, req.userId!],
    );
    const item = result.rows[0];
    if (!item) { res.status(404).json({ error: "MP_SUBSCRIPTION_NOT_FOUND" }); return; }
    res.json({
      provider: "mercadopago", environment: "test", reference: item.reference,
      plan: item.plan, status: item.status, currency: item.currency,
      amount: Number(item.amount_ars),
      checkoutCreated: Boolean(item.provider_preapproval_id),
      paymentVerified: false, entitlementChanged: false,
      message: "Subscription status does not establish that a payment was collected.",
    });
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP subscription status unavailable");
    res.status(503).json({ error: "MP_SUBSCRIPTION_STATUS_UNAVAILABLE" });
  }
});


/** Test-only reconciliation of provider payment evidence; never grants a membership. */
router.post("/billing/mercadopago/sandbox-verify-payment", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED !== "true") {
    res.status(503).json({ error: "MP_SANDBOX_CHECKOUT_DISABLED" }); return;
  }
  const reference = req.body?.reference;
  const paymentId = req.body?.paymentId;
  if (typeof reference !== "string" || !/^echo:(plus|premium):[a-f0-9-]{36}$/.test(reference) ||
      typeof paymentId !== "string" || !/^[A-Za-z0-9_-]{1,128}$/.test(paymentId)) {
    res.status(400).json({ error: "INVALID_MP_PAYMENT_REQUEST" }); return;
  }
  try {
    const intentResult = await pool.query<{
      reference: string; provider_preapproval_id: string | null; amount_ars: string;
    }>(
      `SELECT reference,provider_preapproval_id,amount_ars
       FROM echo_mp_subscription_intents WHERE reference=$1 AND owner_id=$2 LIMIT 1`,
      [reference, req.userId!],
    );
    const intent = intentResult.rows[0];
    if (!intent || !intent.provider_preapproval_id) {
      res.status(404).json({ error: "MP_SUBSCRIPTION_NOT_FOUND" }); return;
    }
    // Provider GET is the only trusted source of payment data.
    const payment = await fetchMpSandboxPayment(paymentId);
    if (payment.subscriptionId !== intent.provider_preapproval_id ||
        payment.currency !== "ARS" || payment.amountArs === null ||
        Math.abs(payment.amountArs - Number(intent.amount_ars)) > 0.001) {
      res.status(409).json({ error: "MP_PAYMENT_SUBSCRIPTION_MISMATCH" }); return;
    }
    await pool.query(
      `INSERT INTO echo_mp_verified_payments
       (provider_payment_id,reference,provider_preapproval_id,provider_status,amount_ars,currency)
       VALUES($1,$2,$3,$4,$5,$6)
       ON CONFLICT (provider_payment_id) DO UPDATE
       SET provider_status=EXCLUDED.provider_status,
           provider_verified_at=now()
       WHERE echo_mp_verified_payments.reference=EXCLUDED.reference
         AND echo_mp_verified_payments.provider_preapproval_id=EXCLUDED.provider_preapproval_id`,
      [payment.id, reference, intent.provider_preapproval_id,
       payment.status, payment.amountArs, payment.currency],
    );
    res.json({
      reference, paymentId: payment.id, paymentStatus: payment.status,
      providerVerified: true, entitlementChanged: false,
      note: "Payment evidence recorded. Membership activation remains disabled.",
    });
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP sandbox payment verification unavailable");
    res.status(503).json({ error: "MP_SANDBOX_PAYMENT_VERIFICATION_UNAVAILABLE" });
  }
});

export default router;
