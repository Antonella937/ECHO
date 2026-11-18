import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { createMpTestPreapproval, fetchMpPreapproval } from "../lib/mercadopagoSubscriptions";

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
 * Opt-in sandbox checkout only. A created preapproval is NOT payment evidence.
 * This endpoint is disabled by default and must not be enabled in production.
 */
router.post("/billing/mercadopago/subscription-test-checkout", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  if (process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED !== "true" ||
      process.env.NODE_ENV === "production") {
    res.status(503).json({ error: "SANDBOX_CHECKOUT_DISABLED" });
    return;
  }
  if (lifetimeAccessForOwner(req.userId!) !== null) {
    res.status(409).json({ error: "BILLING_EXEMPT" });
    return;
  }
  const reference = req.body?.reference;
  const payerEmail = req.body?.payerEmail;
  if (typeof reference !== "string" || typeof payerEmail !== "string") {
    res.status(400).json({ error: "INVALID_CHECKOUT_INPUT" });
    return;
  }
  const callback = process.env.ECHO_MP_CALLBACK_URL;
  if (!callback) {
    res.status(503).json({ error: "MP_CALLBACK_NOT_CONFIGURED" });
    return;
  }
  try {
    // Atomically claim the draft before making a non-idempotent provider call.
    // A failed/ambiguous request stays 'creating' for manual reconciliation.
    const result = await pool.query(
      `UPDATE echo_mp_subscription_intents
       SET status='creating',updated_at=now()
       WHERE reference=$1 AND owner_id=$2 AND status='draft'
         AND provider_preapproval_id IS NULL
       RETURNING reference,plan,amount_ars`,
      [reference, req.userId!],
    );
    const intent = result.rows[0];
    if (!intent) {
      res.status(409).json({ error: "DRAFT_ALREADY_CLAIMED_OR_UNAVAILABLE" });
      return;
    }
    const preapproval = await createMpTestPreapproval({
      reference: intent.reference,
      plan: intent.plan,
      amountArs: Number(intent.amount_ars),
      payerEmail,
      backUrl: callback,
    });
    const updated = await pool.query(
      `UPDATE echo_mp_subscription_intents
       SET provider_preapproval_id=$1,status='pending',updated_at=now()
       WHERE reference=$2 AND owner_id=$3 AND status='creating'
         AND provider_preapproval_id IS NULL RETURNING reference`,
      [preapproval.id, reference, req.userId!],
    );
    if (updated.rowCount !== 1) {
      // A concurrent checkout may have created another provider resource.
      // Do not expose the orphaned checkout URL to the client.
      res.status(409).json({ error: "CHECKOUT_ALREADY_STARTED" });
      return;
    }
    res.status(201).json({
      environment: "test", checkoutEnabled: true,
      reference, checkoutUrl: preapproval.checkoutUrl,
      status: "pending", entitlementChanged: false,
    });
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP sandbox checkout failed");
    res.status(503).json({ error: "SANDBOX_CHECKOUT_UNAVAILABLE" });
  }
});


/**
 * Owner-scoped read-only recovery diagnostics. Never retries a provider POST,
 * resets a claimed draft, or activates paid entitlements.
 */
router.get("/billing/mercadopago/subscription-checkout-status", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const reference = req.query.reference;
  if (typeof reference !== "string" || !/^echo:(plus|premium):[a-f0-9-]{36}$/.test(reference)) {
    res.status(400).json({ error: "INVALID_REFERENCE" });
    return;
  }
  try {
    const result = await pool.query(
      `SELECT status,provider_preapproval_id,updated_at
       FROM echo_mp_subscription_intents
       WHERE reference=$1 AND owner_id=$2 LIMIT 1`,
      [reference, req.userId!],
    );
    const intent = result.rows[0];
    if (!intent) {
      res.status(404).json({ error: "CHECKOUT_NOT_FOUND" });
      return;
    }
    if (!intent.provider_preapproval_id) {
      res.json({
        reference, status: intent.status,
        recovery: intent.status === "creating" ? "manual_review_required" : "none",
        retryAllowed: intent.status === "draft",
        entitlementChanged: false,
      });
      return;
    }
    const provider = await fetchMpPreapproval(intent.provider_preapproval_id);
    if (provider.id !== intent.provider_preapproval_id || provider.externalReference !== reference) {
      res.status(409).json({ error: "PROVIDER_BINDING_MISMATCH", recovery: "manual_review_required" });
      return;
    }
    res.json({
      reference, status: intent.status, providerStatus: provider.status,
      recovery: "linked", retryAllowed: false, entitlementChanged: false,
    });
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP checkout status unavailable");
    res.status(503).json({ error: "CHECKOUT_STATUS_UNAVAILABLE" });
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

export default router;
