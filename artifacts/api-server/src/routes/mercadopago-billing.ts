import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";

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

export default router;
