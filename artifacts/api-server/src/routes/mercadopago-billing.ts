import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";

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
