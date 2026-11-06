import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const targetSchema = z.object({ targetOwnerId: z.string().min(1).max(255) }).strict();
const requestParams = z.object({ requestId: z.string().uuid(), action: z.enum(["accept", "reject"]) }).strict();

/** Moderation of real-account DM initiation, independent from follow privacy. */
export function createCreatorHubMessageRouter(): IRouter {
  const router: IRouter = Router();
  router.use("/creator-hub/messages", requireAuth, (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  router.get("/creator-hub/messages/requests", async (req, res) => {
    const result = await pool.query(
      `SELECT r.id, r.sender_owner_id AS "senderOwnerId", p.username,
       p.display_name AS "displayName", r.created_at AS "createdAt"
       FROM echo_creator_message_requests r
       JOIN echo_creator_profiles p ON p.owner_id=r.sender_owner_id
       WHERE r.recipient_owner_id=$1 AND r.status='pending'
       AND NOT EXISTS(SELECT 1 FROM echo_creator_blocks b WHERE
         (b.blocker_owner_id=$1 AND b.blocked_owner_id=r.sender_owner_id)
         OR (b.blocker_owner_id=r.sender_owner_id AND b.blocked_owner_id=$1))
       ORDER BY r.created_at DESC LIMIT 100`,
      [req.userId],
    );
    res.json({ requests: result.rows });
  });

  router.post("/creator-hub/messages/requests", async (req, res) => {
    const parsed = targetSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.targetOwnerId === req.userId) {
      res.status(400).json({ error: "INVALID_TARGET" }); return;
    }
    const targetId = parsed.data.targetOwnerId;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        "SELECT message_privacy FROM echo_creator_profiles WHERE owner_id=$1 FOR UPDATE",
        [targetId],
      );
      if (!target.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
      const blocked = await client.query(
        `SELECT 1 FROM echo_creator_blocks WHERE
         (blocker_owner_id=$1 AND blocked_owner_id=$2)
         OR (blocker_owner_id=$2 AND blocked_owner_id=$1) LIMIT 1`,
        [req.userId, targetId],
      );
      if (blocked.rowCount || target.rows[0].message_privacy === "nobody") {
        await client.query("ROLLBACK"); res.status(403).json({ error: "MESSAGES_UNAVAILABLE" }); return;
      }
      const accepted = await client.query(
        `SELECT 1 FROM echo_creator_message_requests WHERE status='accepted' AND
         ((sender_owner_id=$1 AND recipient_owner_id=$2)
          OR (sender_owner_id=$2 AND recipient_owner_id=$1)) LIMIT 1`,
        [req.userId, targetId],
      );
      if (accepted.rowCount || target.rows[0].message_privacy === "everyone") {
        await client.query("COMMIT"); res.json({ status: "allowed" }); return;
      }
      const existing = await client.query(
        `SELECT 1 FROM echo_creator_message_requests WHERE sender_owner_id=$1
         AND recipient_owner_id=$2 AND status='pending' LIMIT 1`,
        [req.userId, targetId],
      );
      if (existing.rowCount) {
        await client.query("COMMIT"); res.json({ status: "requested" }); return;
      }
      // A rejected request cannot be immediately resubmitted: explicit owner
      // consent is required before a future request is possible.
      const rejected = await client.query(
        `SELECT 1 FROM echo_creator_message_requests WHERE sender_owner_id=$1
         AND recipient_owner_id=$2 AND status='rejected' LIMIT 1`,
        [req.userId, targetId],
      );
      if (rejected.rowCount) {
        await client.query("ROLLBACK"); res.status(403).json({ error: "REQUEST_REJECTED" }); return;
      }
      await client.query(
        `INSERT INTO echo_creator_message_requests(sender_owner_id,recipient_owner_id)
         VALUES ($1,$2) ON CONFLICT DO NOTHING`,
        [req.userId, targetId],
      );
      await client.query("COMMIT");
      res.json({ status: "requested" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.post("/creator-hub/messages/requests/:requestId/:action", async (req, res) => {
    const parsed = requestParams.safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_REQUEST" }); return; }
    const result = await pool.query(
      `UPDATE echo_creator_message_requests SET status=$3, updated_at=now()
       WHERE id=$1 AND recipient_owner_id=$2 AND status='pending'
       AND NOT EXISTS (SELECT 1 FROM echo_creator_blocks b WHERE
         (b.blocker_owner_id=$2 AND b.blocked_owner_id=sender_owner_id)
         OR (b.blocker_owner_id=sender_owner_id AND b.blocked_owner_id=$2))
       RETURNING id`,
      [parsed.data.requestId, req.userId, parsed.data.action === "accept" ? "accepted" : "rejected"],
    );
    if (!result.rowCount) { res.status(404).json({ error: "REQUEST_NOT_FOUND" }); return; }
    res.json({ status: parsed.data.action === "accept" ? "accepted" : "rejected" });
  });

  router.post("/creator-hub/messages/blocks", async (req, res) => {
    const parsed = targetSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.targetOwnerId === req.userId) {
      res.status(400).json({ error: "INVALID_TARGET" }); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      await client.query(
        "INSERT INTO echo_creator_blocks(blocker_owner_id,blocked_owner_id) VALUES($1,$2) ON CONFLICT DO NOTHING",
        [req.userId, parsed.data.targetOwnerId],
      );
      await client.query(
        `UPDATE echo_creator_message_requests SET status='cancelled',updated_at=now()
         WHERE status='pending' AND ((sender_owner_id=$1 AND recipient_owner_id=$2)
           OR (sender_owner_id=$2 AND recipient_owner_id=$1))`,
        [req.userId, parsed.data.targetOwnerId],
      );
      await client.query("COMMIT");
      res.json({ status: "blocked" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.delete("/creator-hub/messages/blocks/:targetOwnerId", async (req, res) => {
    if (!req.params.targetOwnerId || req.params.targetOwnerId === req.userId) {
      res.status(400).json({ error: "INVALID_TARGET" }); return;
    }
    await pool.query(
      "DELETE FROM echo_creator_blocks WHERE blocker_owner_id=$1 AND blocked_owner_id=$2",
      [req.userId, req.params.targetOwnerId],
    );
    res.json({ status: "unblocked" });
  });

  return router;
}
export const creatorHubMessageRouter = createCreatorHubMessageRouter();
