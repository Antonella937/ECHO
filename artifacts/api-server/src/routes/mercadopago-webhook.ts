import { Router, type IRouter } from "express";
import { pool } from "@workspace/db";
import { verifyMpWebhookSignature } from "../lib/mercadopagoWebhookSignature";
import { fetchMpPreapproval } from "../lib/mercadopagoSubscriptions";
import { nextMpSubscriptionStatus, type MpSubscriptionStatus } from "../lib/mercadopagoReconciliationPolicy";

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
      `SELECT reference,plan,amount_ars,status FROM echo_mp_subscription_intents
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
    // Reconcile the subscription *status* only. No payment or membership grant is made here.
    // Locking and the event key make retries safe and prevent older states from reactivating canceled intents.
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const locked = await client.query<{ status: MpSubscriptionStatus }>(
        `SELECT status FROM echo_mp_subscription_intents
         WHERE reference=$1 AND provider_preapproval_id=$2 FOR UPDATE`,
        [subscription.externalReference, dataId],
      );
      if (!locked.rows.length) {
        await client.query("ROLLBACK");
        res.status(202).json({ accepted: true, ignored: true });
        return;
      }
      const nextStatus = nextMpSubscriptionStatus(locked.rows[0].status, subscription.status);
      await client.query(
        `UPDATE echo_mp_subscription_intents SET status=$3,updated_at=now()
         WHERE reference=$1 AND provider_preapproval_id=$2 AND status<>$3`,
        [subscription.externalReference, dataId, nextStatus],
      );
      await client.query(
        `INSERT INTO echo_mp_webhook_events(event_key,topic,provider_resource_id,status,processed_at)
         VALUES($1,$2,$3,'processed',now()) ON CONFLICT (event_key) DO NOTHING`,
        [eventKey, topic, dataId],
      );
      await client.query("COMMIT");
    } catch (error) {
      await client.query("ROLLBACK");
      throw error;
    } finally {
      client.release();
    }
    res.status(202).json({ accepted: true, entitlementChanged: false });
  } catch (error) {
    req.log.warn({ error: error instanceof Error ? error.name : "unknown" }, "MP webhook processing unavailable");
    res.status(503).json({ error: "MP_WEBHOOK_RETRY" });
  }
});
export default router;
