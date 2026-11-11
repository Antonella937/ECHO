import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";

/** Billing remains explicitly disabled until a reviewed sandbox configuration exists.
 * No endpoint accepts client-reported payment success or directly grants a plan.
 */
const router: IRouter = Router();
const configured = () => ({
  environment: process.env.ECHO_PADDLE_ENVIRONMENT === "sandbox" ? "sandbox" : "disabled",
  clientTokenReady: Boolean(process.env.ECHO_PADDLE_CLIENT_TOKEN?.startsWith("test_")),
  plusPriceReady: Boolean(process.env.ECHO_PADDLE_PLUS_PRICE_ID?.startsWith("pri_")),
  premiumPriceReady: Boolean(process.env.ECHO_PADDLE_PREMIUM_PRICE_ID?.startsWith("pri_")),
  webhookReady: Boolean(process.env.ECHO_PADDLE_WEBHOOK_SECRET),
  serverApiKeyReady: Boolean(process.env.ECHO_PADDLE_API_KEY?.startsWith("pdl_sdbx_")),
  webhookStorageReady: process.env.ECHO_PADDLE_WEBHOOK_STORAGE_READY === "true",
});
router.get("/billing/paddle/config", requireAuth, (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const state = configured();
  const ready = state.environment === "sandbox" && state.clientTokenReady &&
    state.plusPriceReady && state.premiumPriceReady && state.webhookReady &&
    state.serverApiKeyReady && state.webhookStorageReady;
  res.json({
    provider: "paddle", environment: state.environment, ready,
    checkoutEnabled: false,
    billingExempt: lifetimeAccessForOwner(req.userId!) !== null,
    setup: {
      clientToken: state.clientTokenReady,
      plusPrice: state.plusPriceReady,
      premiumPrice: state.premiumPriceReady,
      webhookSecret: state.webhookReady,
      serverApiKey: state.serverApiKeyReady,
      webhookStorage: state.webhookStorageReady,
    },
  });
});
export default router;
