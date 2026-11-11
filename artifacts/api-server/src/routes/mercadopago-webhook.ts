import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { verifyMpWebhookSignature } from "../lib/mercadopagoWebhookSignature";
import { fetchMpPreapproval } from "../lib/mercadopagoSubscriptions";

/**
 * Public provider callback, registered BEFORE the private-beta auth gate.
 * A signed notification is not proof of payment; this only records a verified
 * resource snapshot for future reconciliation. It never grants entitlements.
 */
const router: IRouter = Router();
router.post("/billing/mercadopago/webhook", async (req, res) => {
  res.setHeader("Cache-Control", "no-store");
  const dataId = typeof req.query["data.id"] === "string"
    ? req.query["data.id"] : typeof req.body?.data?.id === "string" ? req.body.data.id : "";
  const signature = req.header("x-signature");
  const requestId = req.header("x-request-id");
  if (!verifyMpWebhookSignature({
    signature, requestId, dataId,
    secret: process.env.ECHO_MP_WEBHOOK_SECRET,
  })) {
    res.status(401).json({ error: "INVALID_MP_SIGNATURE" });
    return;
  }
  const topic = typeof req.body?.type === "string" ? req.body.type : "";
  if (topic !== "subscription_preapproval") {
    res.status(202).json({ accepted: true, ignored: true });
    return;
  }
  try {
    const subscription = await fetchMpPreapproval(dataId);
    if (subscription.id !== dataId || !subscription.externalReference) {
      res.status(202).json({ accepted: true, ignored: true });
      return;
    }
    const result = await pool.query(
      `SELECT reference,plan,amount_ars FROM echo_mp_subscription_intents
       WHERE reference=$1 AND provider_preapproval_id=$2 LIMIT 1`,
      [subscription.externalReference, dataId],
    );
    const intent = result.rows[0];
    if (!intent || subscription.amountArs === null ||
      Math.abs(Number(intent.amount_ars) - subscription.amountArs) > 0.001) {
      res.status(202).json({ accepted: true, ignored: true });
      return;
    }
    const eventKey = `preapproval:${dataId}:${subscription.status}:${requestId}`;
    await pool.query(
      `INSERT INTO echo_mp_webhook_events(event_key,topic,provider_resource_id,status)
       VALUES($1,$2,$3,'received') ON CONFLICT (event_key) DO NOTHING`,
      [eventKey, topic, dataId],
    );
    res.status(202).json({ accepted: true, entitlementChanged: false });
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP webhook processing unavailable");
    res.status(503).json({ error: "MP_WEBHOOK_RETRY" });
  }
});
export default router;
