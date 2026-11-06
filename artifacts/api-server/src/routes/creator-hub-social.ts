import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

// These are account profiles, not simulated characters. The authenticated Clerk
// identity is always taken from the server, never from a request body.
const profileSchema = z.object({
  displayName: z.string().trim().min(2).max(80),
  username: z.string().trim().toLowerCase().regex(/^[a-z0-9._]{3,30}$/),
  visibility: z.enum(["private", "public"]).optional(),
  messagePrivacy: z.enum(["everyone", "requests", "nobody"]).optional(),
  bio: z.string().max(500).default(""),
}).strict();
const searchSchema = z.object({ q: z.string().trim().min(2).max(80) }).strict();
const targetSchema = z.object({ targetOwnerId: z.string().min(1).max(255) }).strict();
const requestSchema = z.object({ requestId: z.string().uuid(), action: z.enum(["accept", "reject"]) }).strict();

export function createCreatorHubSocialRouter(): IRouter {
  const router: IRouter = Router();
  router.use("/creator-hub/social", requireAuth, (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    next();
  });

  router.get("/creator-hub/social/me", async (req, res) => {
    const result = await pool.query(
      "SELECT display_name AS \"displayName\", username, visibility, message_privacy AS \"messagePrivacy\", bio FROM echo_creator_profiles WHERE owner_id=$1",
      [req.userId],
    );
    res.json({ profile: result.rows[0] ?? null });
  });

  router.put("/creator-hub/social/me", async (req, res) => {
    const parsed = profileSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_PROFILE" }); return; }
    const { displayName, username, visibility, bio, messagePrivacy } = parsed.data;
    try {
      const result = await pool.query(
        `INSERT INTO echo_creator_profiles (owner_id, display_name, username, username_key, visibility, bio, message_privacy)
         VALUES ($1,$2,$3,lower($3),coalesce($4,'private'),$5,coalesce($6,'requests'))
         ON CONFLICT (owner_id) DO UPDATE SET
         display_name=excluded.display_name,
         username=excluded.username, username_key=excluded.username_key,
         visibility=coalesce($4,echo_creator_profiles.visibility), bio=excluded.bio, message_privacy=coalesce($6,echo_creator_profiles.message_privacy), updated_at=now()
         RETURNING display_name AS "displayName", username, visibility, message_privacy AS "messagePrivacy", bio`,
        [req.userId, displayName, username, visibility, bio, messagePrivacy ?? null],
      );
      res.json({ profile: result.rows[0] });
    } catch (error) {
      if ((error as { code?: string }).code === "23505") {
        res.status(409).json({ error: "USERNAME_ALREADY_IN_USE" }); return;
      }
      throw error;
    }
  });

  router.get("/creator-hub/social/search", async (req, res) => {
    const parsed = searchSchema.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_SEARCH" }); return; }
    const q = parsed.data.q.replace(/[\\%_]/g, "\\$&");
    const result = await pool.query(
      `SELECT p.owner_id AS "ownerId", p.display_name AS "displayName", p.username, p.visibility,
        EXISTS(SELECT 1 FROM echo_creator_follows f WHERE f.follower_owner_id=$1 AND f.followed_owner_id=p.owner_id) AS "following",
        EXISTS(SELECT 1 FROM echo_creator_follow_requests r WHERE r.requester_owner_id=$1 AND r.recipient_owner_id=p.owner_id AND r.status='pending') AS "requested"
       FROM echo_creator_profiles p WHERE p.owner_id<>$1 AND NOT EXISTS (SELECT 1 FROM echo_creator_blocks b WHERE (b.blocker_owner_id=$1 AND b.blocked_owner_id=p.owner_id) OR (b.blocker_owner_id=p.owner_id AND b.blocked_owner_id=$1))
         AND (p.display_name ILIKE $2 ESCAPE '\\' OR p.username ILIKE $2 ESCAPE '\\')
       ORDER BY p.username_key LIMIT 20`,
      [req.userId, `%${q}%`],
    );
    res.json({ profiles: result.rows });
  });

  router.post("/creator-hub/social/follow", async (req, res) => {
    const parsed = targetSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.targetOwnerId === req.userId) {
      res.status(400).json({ error: "INVALID_TARGET" }); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        "SELECT visibility FROM echo_creator_profiles WHERE owner_id=$1 FOR UPDATE",
        [parsed.data.targetOwnerId],
      );
      if (!target.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
      const blocked = await client.query("SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)", [req.userId, parsed.data.targetOwnerId]);
      if (blocked.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
      const already = await client.query(
        "SELECT 1 FROM echo_creator_follows WHERE follower_owner_id=$1 AND followed_owner_id=$2",
        [req.userId, parsed.data.targetOwnerId],
      );
      if (already.rowCount) { await client.query("COMMIT"); res.json({ status: "following" }); return; }
      if (target.rows[0].visibility === "public") {
        await client.query(
          "INSERT INTO echo_creator_follows(follower_owner_id,followed_owner_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [req.userId, parsed.data.targetOwnerId],
        );
        await client.query("COMMIT");
        res.json({ status: "following" });
      } else {
        await client.query(
          `INSERT INTO echo_creator_follow_requests(requester_owner_id,recipient_owner_id)
           VALUES ($1,$2) ON CONFLICT DO NOTHING`,
          [req.userId, parsed.data.targetOwnerId],
        );
        await client.query("COMMIT");
        res.json({ status: "requested" });
      }
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  // Request initiation is separate from sending a message. No message body is
  // accepted here and no recipient inbox is exposed to the sender.
  router.post("/creator-hub/social/message-requests", async (req, res) => {
    const parsed = targetSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.targetOwnerId === req.userId) {
      res.status(400).json({ error: "INVALID_TARGET" }); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        "SELECT message_privacy FROM echo_creator_profiles WHERE owner_id=$1 FOR UPDATE",
        [parsed.data.targetOwnerId],
      );
      if (!target.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
      const blocked = await client.query(
        "SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)",
        [req.userId, parsed.data.targetOwnerId],
      );
      if (blocked.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
      const accepted = await client.query(
        "SELECT 1 FROM echo_creator_message_requests WHERE sender_owner_id=$1 AND recipient_owner_id=$2 AND status='accepted'",
        [req.userId, parsed.data.targetOwnerId],
      );
      if (accepted.rowCount) { await client.query("COMMIT"); res.json({ status: "accepted" }); return; }
      if (target.rows[0].message_privacy === "nobody") {
        await client.query("ROLLBACK"); res.status(403).json({ error: "MESSAGES_DISABLED" }); return;
      }
      if (target.rows[0].message_privacy === "everyone") {
        await client.query("COMMIT"); res.json({ status: "allowed" }); return;
      }
      // A rejected request cannot be re-sent automatically. This prevents
      // harassment via repeated request notifications.
      const rejected = await client.query(
        "SELECT 1 FROM echo_creator_message_requests WHERE sender_owner_id=$1 AND recipient_owner_id=$2 AND status='rejected'",
        [req.userId, parsed.data.targetOwnerId],
      );
      if (rejected.rowCount) { await client.query("ROLLBACK"); res.status(403).json({ error: "REQUEST_NOT_ALLOWED" }); return; }
      await client.query(
        `INSERT INTO echo_creator_message_requests(sender_owner_id,recipient_owner_id)
         VALUES($1,$2) ON CONFLICT DO NOTHING`,
        [req.userId, parsed.data.targetOwnerId],
      );
      await client.query("COMMIT");
      res.json({ status: "requested" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  // A recipient-scoped inbox: never return another user's requests.
  router.get("/creator-hub/social/message-requests", async (req, res) => {
    const result = await pool.query(
      `SELECT r.id, r.sender_owner_id AS "senderOwnerId",
       p.display_name AS "displayName", p.username, r.created_at AS "createdAt"
       FROM echo_creator_message_requests r
       JOIN echo_creator_profiles p ON p.owner_id=r.sender_owner_id
       WHERE r.recipient_owner_id=$1 AND r.status='pending'
       ORDER BY r.created_at DESC LIMIT 100`,
      [req.userId],
    );
    res.json({ requests: result.rows });
  });

  router.post("/creator-hub/social/message-requests/:requestId/:action", async (req, res) => {
    const parsed = requestSchema.safeParse(req.params);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_REQUEST" }); return; }
    const result = await pool.query(
      `UPDATE echo_creator_message_requests SET status=$3, updated_at=now()
       WHERE id=$1 AND recipient_owner_id=$2 AND status='pending'
       RETURNING id`,
      [parsed.data.requestId, req.userId, parsed.data.action === "accept" ? "accepted" : "rejected"],
    );
    if (!result.rowCount) { res.status(404).json({ error: "REQUEST_NOT_FOUND" }); return; }
    res.json({ status: parsed.data.action === "accept" ? "accepted" : "rejected" });
  });

  router.post("/creator-hub/social/blocks", async (req, res) => {
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
        `UPDATE echo_creator_message_requests SET status='rejected',updated_at=now()
         WHERE recipient_owner_id=$1 AND sender_owner_id=$2 AND status='pending'`,
        [req.userId, parsed.data.targetOwnerId],
      );
      await client.query(
        `UPDATE echo_creator_follow_requests SET status='rejected',updated_at=now()
         WHERE recipient_owner_id=$1 AND requester_owner_id=$2 AND status='pending'`,
        [req.userId, parsed.data.targetOwnerId],
      );
      await client.query(
        `DELETE FROM echo_creator_follows WHERE
         (follower_owner_id=$1 AND followed_owner_id=$2)
         OR (follower_owner_id=$2 AND followed_owner_id=$1)`,
        [req.userId, parsed.data.targetOwnerId],
      );
      await client.query("COMMIT");
      res.json({ blocked: true });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.get("/creator-hub/social/requests", async (req, res) => {
    const result = await pool.query(
      `SELECT r.id, r.requester_owner_id AS "requesterOwnerId",
       p.display_name AS "displayName", p.username, r.created_at AS "createdAt"
       FROM echo_creator_follow_requests r
       JOIN echo_creator_profiles p ON p.owner_id=r.requester_owner_id
       WHERE r.recipient_owner_id=$1 AND r.status='pending'
       ORDER BY r.created_at DESC LIMIT 100`,
      [req.userId],
    );
    res.json({ requests: result.rows });
  });

  router.post("/creator-hub/social/requests/:requestId/:action", async (req, res) => {
    const parsed = requestSchema.safeParse(req.params);
    const action = req.params.action;
    if (!parsed.success || (action !== "accept" && action !== "reject")) {
      res.status(400).json({ error: "INVALID_REQUEST" }); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE echo_creator_follow_requests SET status=$3,updated_at=now()
         WHERE id=$1 AND recipient_owner_id=$2 AND status='pending'
         RETURNING requester_owner_id,recipient_owner_id`,
        [parsed.data.requestId, req.userId, action === "accept" ? "accepted" : "rejected"],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "REQUEST_NOT_FOUND" }); return; }
      if (action === "accept") {
        await client.query(
          "INSERT INTO echo_creator_follows(follower_owner_id,followed_owner_id) VALUES ($1,$2) ON CONFLICT DO NOTHING",
          [result.rows[0].requester_owner_id, req.userId],
        );
      }
      await client.query("COMMIT");
      res.json({ status: action === "accept" ? "following" : "rejected" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  router.delete("/creator-hub/social/follow/:targetOwnerId", async (req, res) => {
    const target = req.params.targetOwnerId;
    if (!target || target === req.userId) { res.status(400).json({ error: "INVALID_TARGET" }); return; }
    await pool.query(
      "DELETE FROM echo_creator_follows WHERE follower_owner_id=$1 AND followed_owner_id=$2",
      [req.userId, target],
    );
    await pool.query(
      `UPDATE echo_creator_follow_requests SET status='cancelled',updated_at=now()
       WHERE requester_owner_id=$1 AND recipient_owner_id=$2 AND status='pending'`,
      [req.userId, target],
    );
    res.json({ status: "not_following" });
  });
  return router;
}
export const creatorHubSocialRouter = createCreatorHubSocialRouter();
