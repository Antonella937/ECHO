import { validMediaHeader } from "../lib/mediaSafety";
import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { clerkClient } from "@clerk/express";
import { ensureCreatorProfile } from "../lib/creatorProfileBootstrap";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";

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

  const languageSchema = z.object({ language: z.enum(["es", "en", "pt", "fr", "de", "it", "ko", "ja", "zh"]) }).strict();
  router.get("/account/interface-language", async (req, res) => {
    const user = await clerkClient.users.getUser(req.userId!);
    const stored = user.privateMetadata?.echoInterfaceLanguage;
    res.json({ language: typeof stored === "string" && languageSchema.shape.language.safeParse(stored).success ? stored : null });
  });
  router.put("/account/interface-language", async (req, res) => {
    const parsed = languageSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_LANGUAGE" }); return; }
    await clerkClient.users.updateUserMetadata(req.userId!, { privateMetadata: { echoInterfaceLanguage: parsed.data.language } });
    res.json({ language: parsed.data.language });
  });

  router.get("/creator-hub/social/me", async (req, res) => {
    const result = await pool.query(
      "SELECT display_name AS \"displayName\", username, visibility, message_privacy AS \"messagePrivacy\", bio FROM echo_creator_profiles WHERE owner_id=$1",
      [req.userId],
    );
    res.json({ profile: result.rows[0] ?? null });
  });

  router.get("/creator-hub/social/follow-counts", async (req, res) => {
    const result = await pool.query(
      `SELECT
         (SELECT count(*)::int FROM echo_creator_follows WHERE followed_owner_id=$1) AS followers,
         (SELECT count(*)::int FROM echo_creator_follows WHERE follower_owner_id=$1) AS following`,
      [req.userId],
    );
    res.json(result.rows[0] ?? { followers: 0, following: 0 });
  });

  router.get("/creator-hub/social/follow-list/:kind", async (req, res) => {
    const kind = req.params.kind;
    if (kind !== "followers" && kind !== "following") { res.status(400).json({ error: "INVALID_LIST" }); return; }
    const result = await pool.query(
      `SELECT p.owner_id AS "ownerId", p.display_name AS "displayName", p.username,
              p.visibility,
              EXISTS(SELECT 1 FROM echo_creator_follows mine WHERE mine.follower_owner_id=$1 AND mine.followed_owner_id=p.owner_id) AS "following",
              false AS "requested"
       FROM echo_creator_follows f
       JOIN echo_creator_profiles p ON p.owner_id = ${kind === "followers" ? "f.follower_owner_id" : "f.followed_owner_id"}
       WHERE ${kind === "followers" ? "f.followed_owner_id" : "f.follower_owner_id"}=$1
         AND NOT EXISTS (SELECT 1 FROM echo_creator_blocks b
           WHERE (b.blocker_owner_id=$1 AND b.blocked_owner_id=p.owner_id)
              OR (b.blocker_owner_id=p.owner_id AND b.blocked_owner_id=$1))
       ORDER BY p.display_name ASC LIMIT 500`,
      [req.userId],
    );
    res.json({ profiles: result.rows });
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
    const q = parsed.data.q.replace(/^@+/, "").replace(/[\\%_]/g, "\\$&");
    // Search only existing Creator Hub profiles. Never enumerate Clerk accounts or
    // create profiles from another user's search query.
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

  router.get("/creator-hub/social/profile/:ownerId", async (req, res) => {
    const ownerId = req.params.ownerId;
    if (!ownerId || ownerId.length > 255) { res.status(400).json({ error: "INVALID_OWNER" }); return; }
    const result = await pool.query(
      `SELECT p.display_name AS "displayName", p.username, p.visibility, p.bio,
         EXISTS (SELECT 1 FROM echo_creator_follows f WHERE f.follower_owner_id=$1 AND f.followed_owner_id=$2) AS following,
         EXISTS (SELECT 1 FROM echo_creator_follow_requests r WHERE r.requester_owner_id=$1 AND r.recipient_owner_id=$2 AND r.status='pending') AS requested
       FROM echo_creator_profiles p WHERE p.owner_id=$2
       AND NOT EXISTS (SELECT 1 FROM echo_creator_blocks b WHERE
         (b.blocker_owner_id=$1 AND b.blocked_owner_id=$2) OR
         (b.blocker_owner_id=$2 AND b.blocked_owner_id=$1))`,
      [req.userId, ownerId],
    );
    if (!result.rowCount) { res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
    const profile = result.rows[0];
    try {
      const account = await clerkClient.users.getUser(ownerId);
      const metadata = account.unsafeMetadata ?? {};
      const avatarRef = typeof metadata.creatorHubAvatar === "string" ? metadata.creatorHubAvatar : null;
      const bannerRef = typeof metadata.creatorHubBanner === "string" ? metadata.creatorHubBanner : null;
      const position = metadata.creatorHubAvatarPosition;
      const avatarPosition = position && typeof position === "object" && !Array.isArray(position) &&
        typeof (position as { x?: unknown }).x === "number" && typeof (position as { y?: unknown }).y === "number"
        ? { x: (position as { x: number }).x, y: (position as { y: number }).y } : null;
      const role = lifetimeAccessForOwner(ownerId);
      res.json({ profile: { ...profile, avatarRef, bannerRef, avatarPosition,
        verificationRole: role, roleLabel: role === "owner_lifetime" ? "CEO & Founder of ECHO" : role === "founder_lifetime" ? "First ECHO Tester" : null } });
    } catch (error) {
      console.warn("Creator profile media unavailable", error instanceof Error ? error.message : "unknown");
      res.json({ profile: { ...profile, verificationRole: lifetimeAccessForOwner(ownerId), roleLabel: lifetimeAccessForOwner(ownerId) === "owner_lifetime" ? "CEO & Founder of ECHO" : lifetimeAccessForOwner(ownerId) === "founder_lifetime" ? "First ECHO Tester" : null } });
    }
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

  const reactionSchema = z.object({ messageId: z.string().uuid(), emoji: z.enum(["❤️","😂","🥹","😍","👍","🔥","😮","😢"]) }).strict();
  router.post("/creator-hub/social/reactions", async (req, res) => {
    const parsed = reactionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_REACTION" }); return; }
    const result = await pool.query(
      "INSERT INTO echo_creator_message_reactions(message_id,reactor_owner_id,emoji) SELECT m.id,$1,$3 FROM echo_creator_direct_messages m WHERE m.id=$2 AND (m.sender_owner_id=$1 OR m.recipient_owner_id=$1) AND NOT EXISTS (SELECT 1 FROM echo_creator_blocks b WHERE (b.blocker_owner_id=m.sender_owner_id AND b.blocked_owner_id=m.recipient_owner_id) OR (b.blocker_owner_id=m.recipient_owner_id AND b.blocked_owner_id=m.sender_owner_id)) ON CONFLICT DO NOTHING RETURNING message_id",
      [req.userId, parsed.data.messageId, parsed.data.emoji],
    );
    res.json({ added: Boolean(result.rowCount) });
  });
  router.delete("/creator-hub/social/reactions", async (req, res) => {
    const parsed = reactionSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_REACTION" }); return; }
    await pool.query("DELETE FROM echo_creator_message_reactions WHERE message_id=$1 AND reactor_owner_id=$2 AND emoji=$3", [parsed.data.messageId, req.userId, parsed.data.emoji]);
    res.json({ removed: true });
  });
  const typingSchema = z.object({ targetOwnerId: z.string().min(1).max(255), typing: z.boolean() }).strict();
  router.post("/creator-hub/social/typing", async (req, res) => {
    const parsed = typingSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.targetOwnerId === req.userId) { res.status(400).json({ error: "INVALID_TARGET" }); return; }
    const blocked = await pool.query("SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)", [req.userId, parsed.data.targetOwnerId]);
    if (blocked.rowCount) { res.status(403).json({ error: "MESSAGES_NOT_ALLOWED" }); return; }
    const eligible = await pool.query("SELECT 1 FROM echo_creator_profiles WHERE owner_id=$1", [parsed.data.targetOwnerId]);
    if (!eligible.rowCount) { res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
    const permission = await pool.query(
      "SELECT 1 FROM echo_creator_message_requests WHERE status='accepted' AND ((sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1)) UNION SELECT 1 FROM echo_creator_direct_messages WHERE (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) UNION SELECT 1 FROM echo_creator_profiles WHERE owner_id=$2 AND message_privacy='everyone' LIMIT 1",
      [req.userId, parsed.data.targetOwnerId],
    );
    if (!permission.rowCount) { res.status(403).json({ error: "MESSAGE_REQUEST_REQUIRED" }); return; }
    if (parsed.data.typing) await pool.query("INSERT INTO echo_creator_typing_presence(sender_owner_id,recipient_owner_id,expires_at) VALUES($1,$2,now()+interval '6 seconds') ON CONFLICT(sender_owner_id,recipient_owner_id) DO UPDATE SET expires_at=excluded.expires_at", [req.userId, parsed.data.targetOwnerId]);
    else await pool.query("DELETE FROM echo_creator_typing_presence WHERE sender_owner_id=$1 AND recipient_owner_id=$2", [req.userId, parsed.data.targetOwnerId]);
    res.json({ ok: true });
  });
  router.get("/creator-hub/social/typing/:targetOwnerId", async (req, res) => {
    const target = req.params.targetOwnerId;
    if (!target || target === req.userId || target.length > 255) { res.status(400).json({ error: "INVALID_TARGET" }); return; }
    const blocked = await pool.query(
      "SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)",
      [req.userId, target],
    );
    if (blocked.rowCount) { res.status(404).json({ error: "CONVERSATION_NOT_FOUND" }); return; }
    const permitted = await pool.query(
      "SELECT 1 FROM echo_creator_message_requests WHERE status='accepted' AND ((sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1)) UNION SELECT 1 FROM echo_creator_direct_messages WHERE (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) UNION SELECT 1 FROM echo_creator_voice_messages WHERE (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) UNION SELECT 1 FROM echo_creator_profiles WHERE owner_id=$2 AND message_privacy='everyone' LIMIT 1",
      [req.userId, target],
    );
    if (!permitted.rowCount) { res.status(404).json({ error: "CONVERSATION_NOT_FOUND" }); return; }
    const result = await pool.query("SELECT EXISTS(SELECT 1 FROM echo_creator_typing_presence WHERE sender_owner_id=$2 AND recipient_owner_id=$1 AND expires_at>now()) AS typing", [req.userId, target]);
    res.json({ typing: Boolean(result.rows[0]?.typing) });
  });

  const voiceSchema = z.object({
    targetOwnerId: z.string().min(1).max(255),
    objectPath: z.string().regex(new RegExp('^/objects/uploads/[0-9a-f-]{36}$', 'i')),
    durationSeconds: z.number().int().min(1).max(120),
  }).strict();
  router.post("/creator-hub/social/voice-messages", async (req, res) => {
    const parsed = voiceSchema.safeParse(req.body);
    if (!parsed.success || parsed.data.targetOwnerId === req.userId) {
      res.status(400).json({ error: "INVALID_VOICE_MESSAGE" }); return;
    }
    const { targetOwnerId, objectPath, durationSeconds } = parsed.data;
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const owned = await client.query(
        "SELECT 1 FROM echo_media WHERE owner_id=$1 AND object_path=$2",
        [req.userId, objectPath],
      );
      if (!owned.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "MEDIA_NOT_FOUND" }); return; }
      // A registered object is not proof of its type: independently inspect
      // the private stored bytes before linking them to a human DM.
      const supabaseBase = process.env.SUPABASE_URL?.replace(new RegExp("/$"), "");
      const supabaseKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!supabaseBase || !supabaseKey || !supabaseBase.startsWith("https://") || !supabaseBase.endsWith(".supabase.co")) {
        await client.query("ROLLBACK"); res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); return;
      }
      const stored = await fetch(supabaseBase + "/storage/v1/object/echo-media/" + objectPath.slice("/objects/".length), {
        headers: { Authorization: "Bearer " + supabaseKey, apikey: supabaseKey },
        signal: AbortSignal.timeout(15000),
      });
      if (!stored.ok) { await client.query("ROLLBACK"); res.status(400).json({ error: "VOICE_UPLOAD_MISSING" }); return; }
      const mime = (stored.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (!["audio/webm", "audio/ogg", "audio/mp4", "audio/mpeg", "audio/wav"].includes(mime)) {
        await client.query("ROLLBACK"); res.status(415).json({ error: "VOICE_FORMAT_UNSUPPORTED" }); return;
      }
      const maxBytes = 15 * 1024 * 1024;
      const length = Number(stored.headers.get("content-length"));
      if (Number.isFinite(length) && length > maxBytes) {
        await client.query("ROLLBACK"); res.status(413).json({ error: "VOICE_TOO_LARGE" }); return;
      }
      const bytes = Buffer.from(await stored.arrayBuffer());
      if (!bytes.length || bytes.length > maxBytes || !validMediaHeader(bytes.subarray(0, 64), mime)) {
        await client.query("ROLLBACK"); res.status(400).json({ error: "INVALID_VOICE_BYTES" }); return;
      }

      const target = await client.query("SELECT message_privacy FROM echo_creator_profiles WHERE owner_id=$1 FOR UPDATE", [targetOwnerId]);
      if (!target.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return; }
      const blocked = await client.query("SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)", [req.userId,targetOwnerId]);
      if (blocked.rowCount) { await client.query("ROLLBACK"); res.status(403).json({ error: "MESSAGES_NOT_ALLOWED" }); return; }
      const connected = await client.query(
        "SELECT 1 FROM echo_creator_message_requests WHERE status='accepted' AND ((sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1)) UNION SELECT 1 FROM echo_creator_direct_messages WHERE (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) UNION SELECT 1 FROM echo_creator_voice_messages WHERE (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) LIMIT 1",
        [req.userId,targetOwnerId],
      );
      if (!connected.rowCount && target.rows[0].message_privacy !== "everyone") {
        await client.query("ROLLBACK"); res.status(403).json({ error: "MESSAGE_REQUEST_REQUIRED" }); return;
      }
      const result = await client.query(
        `INSERT INTO echo_creator_voice_messages(sender_owner_id,recipient_owner_id,object_path,duration_seconds)
         VALUES($1,$2,$3,$4) RETURNING message_id AS "id",object_path AS "objectPath",duration_seconds AS "durationSeconds",created_at AS "createdAt"`,
        [req.userId,targetOwnerId,objectPath,durationSeconds],
      );
      await client.query("COMMIT");
      res.status(201).json({ voiceMessage: result.rows[0] });
    } catch(error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  const dmBodySchema = z.object({
    targetOwnerId: z.string().min(1).max(255),
    body: z.string().trim().min(1).max(2000),
  }).strict();

  router.post("/creator-hub/social/messages", async (req, res) => {
    const parsed = dmBodySchema.safeParse(req.body);
    if (!parsed.success || parsed.data.targetOwnerId === req.userId) {
      res.status(400).json({ error: "INVALID_MESSAGE" }); return;
    }
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const target = await client.query(
        "SELECT message_privacy FROM echo_creator_profiles WHERE owner_id=$1 FOR UPDATE",
        [parsed.data.targetOwnerId],
      );
      const sender = await client.query(
        "SELECT 1 FROM echo_creator_profiles WHERE owner_id=$1",
        [req.userId],
      );
      if (!target.rowCount || !sender.rowCount) {
        await client.query("ROLLBACK"); res.status(404).json({ error: "PROFILE_NOT_FOUND" }); return;
      }
      const blocked = await client.query(
        "SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)",
        [req.userId, parsed.data.targetOwnerId],
      );
      if (blocked.rowCount) {
        await client.query("ROLLBACK"); res.status(403).json({ error: "MESSAGES_NOT_ALLOWED" }); return;
      }
      const accepted = await client.query(
        `SELECT 1 FROM echo_creator_message_requests WHERE
         ((sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1))
         AND status='accepted' LIMIT 1`,
        [req.userId, parsed.data.targetOwnerId],
      );
      const previouslyConnected = await client.query(
        `SELECT 1 FROM echo_creator_direct_messages WHERE
         (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) LIMIT 1`,
        [req.userId, parsed.data.targetOwnerId],
      );
      const canSend = accepted.rowCount || (target.rows[0].message_privacy === "everyone" && !previouslyConnected.rowCount);
      // Existing conversations continue unless blocked, except when recipient
      // has explicitly disabled all messages.
      const allowed = Boolean(canSend || previouslyConnected.rowCount);
      if (!allowed) {
        await client.query("ROLLBACK"); res.status(403).json({ error: "MESSAGE_REQUEST_REQUIRED" }); return;
      }
      const result = await client.query(
        `INSERT INTO echo_creator_direct_messages(sender_owner_id,recipient_owner_id,body)
         VALUES($1,$2,$3) RETURNING id, sender_owner_id AS "senderOwnerId",
         recipient_owner_id AS "recipientOwnerId", body, created_at AS "createdAt"`,
        [req.userId, parsed.data.targetOwnerId, parsed.data.body],
      );
      await client.query("COMMIT");
      res.status(201).json({ message: result.rows[0] });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  // Creator Hub notification preferences and cross-device read receipts are private to the signed-in account.
  router.get("/creator-hub/social/dm-notifications", async (req, res) => {
    const user = await clerkClient.users.getUser(req.userId!);
    const enabled = user.privateMetadata?.echoCreatorHubNotifications !== false;
    const raw = user.privateMetadata?.echoCreatorHubDmReadAt;
    const readAt = raw && typeof raw === "object" && !Array.isArray(raw) ? raw as Record<string, unknown> : {};
    const result = await pool.query(
      `WITH incoming AS (
        SELECT sender_owner_id AS peer_id, created_at, id::text AS message_id, body AS preview, 'text' AS kind
        FROM echo_creator_direct_messages WHERE recipient_owner_id=$1
        UNION ALL
        SELECT sender_owner_id AS peer_id, created_at, message_id::text AS message_id, '' AS preview, 'voice' AS kind
        FROM echo_creator_voice_messages WHERE recipient_owner_id=$1
      )
      SELECT DISTINCT ON (i.peer_id) i.peer_id AS "ownerId", p.display_name AS "displayName",
        p.username, i.created_at AS "createdAt", i.message_id AS "messageId",
        i.preview, i.kind
      FROM incoming i JOIN echo_creator_profiles p ON p.owner_id=i.peer_id
      WHERE NOT EXISTS (SELECT 1 FROM echo_creator_blocks b WHERE
        (b.blocker_owner_id=$1 AND b.blocked_owner_id=i.peer_id)
        OR (b.blocker_owner_id=i.peer_id AND b.blocked_owner_id=$1))
      ORDER BY i.peer_id, i.created_at DESC, i.message_id DESC LIMIT 100`,
      [req.userId],
    );
    const items = result.rows.map(row => ({
      ...row,
      unread: new Date(row.createdAt).getTime() > new Date(typeof readAt[row.ownerId] === "string" ? readAt[row.ownerId] as string : "1970-01-01").getTime(),
    }));
    res.json({ enabled, items });
  });
  router.put("/creator-hub/social/dm-notifications/preferences", async (req, res) => {
    const parsed = z.object({ enabled: z.boolean() }).strict().safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_PREFERENCES" }); return; }
    await clerkClient.users.updateUserMetadata(req.userId!, { privateMetadata: { echoCreatorHubNotifications: parsed.data.enabled } });
    res.json({ enabled: parsed.data.enabled });
  });
  router.put("/creator-hub/social/dm-notifications/read", async (req, res) => {
    const parsed = z.object({ ownerId: z.string().min(1).max(255) }).strict().safeParse(req.body);
    if (!parsed.success || parsed.data.ownerId === req.userId) { res.status(400).json({ error: "INVALID_PEER" }); return; }
    const latest = await pool.query(
      `SELECT MAX(created_at) AS latest FROM (
        SELECT created_at FROM echo_creator_direct_messages WHERE recipient_owner_id=$1 AND sender_owner_id=$2
        UNION ALL
        SELECT created_at FROM echo_creator_voice_messages WHERE recipient_owner_id=$1 AND sender_owner_id=$2
      ) messages`, [req.userId, parsed.data.ownerId],
    );
    const user = await clerkClient.users.getUser(req.userId!);
    const previous = user.privateMetadata?.echoCreatorHubDmReadAt;
    const receipts = previous && typeof previous === "object" && !Array.isArray(previous) ? previous as Record<string, string> : {};
    const latestTime = latest.rows[0]?.latest;
    if (latestTime) {
      const next = { ...receipts, [parsed.data.ownerId]: new Date(latestTime).toISOString() };
      await clerkClient.users.updateUserMetadata(req.userId!, { privateMetadata: { echoCreatorHubDmReadAt: Object.fromEntries(Object.entries(next).slice(-100)) } });
    }
    res.json({ ok: true });
  });

  router.get("/creator-hub/social/messages/:targetOwnerId", async (req, res) => {
    const target = req.params.targetOwnerId;
    if (!target || target === req.userId || target.length > 255) {
      res.status(400).json({ error: "INVALID_TARGET" }); return;
    }
    const blocked = await pool.query(
      "SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)",
      [req.userId, target],
    );
    if (blocked.rowCount) { res.status(404).json({ error: "CONVERSATION_NOT_FOUND" }); return; }
    const relationship = await pool.query(
      "SELECT 1 FROM echo_creator_message_requests WHERE status='accepted' AND ((sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1)) UNION SELECT 1 FROM echo_creator_direct_messages WHERE (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) UNION SELECT 1 FROM echo_creator_voice_messages WHERE (sender_owner_id=$1 AND recipient_owner_id=$2) OR (sender_owner_id=$2 AND recipient_owner_id=$1) LIMIT 1",
      [req.userId, target],
    );
    if (!relationship.rowCount) { res.status(404).json({ error: "CONVERSATION_NOT_FOUND" }); return; }
    const messages = await pool.query(
      `SELECT id, sender_owner_id AS "senderOwnerId", recipient_owner_id AS "recipientOwnerId",
       body, created_at AS "createdAt",
       (SELECT COALESCE(json_agg(json_build_object('emoji',r.emoji,'ownerId',r.reactor_owner_id)),'[]'::json)
        FROM echo_creator_message_reactions r WHERE r.message_id=echo_creator_direct_messages.id) AS reactions
       FROM echo_creator_direct_messages
       WHERE (sender_owner_id=$1 AND recipient_owner_id=$2)
          OR (sender_owner_id=$2 AND recipient_owner_id=$1)
       ORDER BY created_at DESC, id DESC LIMIT 100`,
      [req.userId, target],
    );
    const voices = await pool.query(
      `SELECT message_id AS "id", sender_owner_id AS "senderOwnerId",
       recipient_owner_id AS "recipientOwnerId", object_path AS "objectPath",
       duration_seconds AS "durationSeconds", created_at AS "createdAt"
       FROM echo_creator_voice_messages
       WHERE (sender_owner_id=$1 AND recipient_owner_id=$2)
          OR (sender_owner_id=$2 AND recipient_owner_id=$1)
       ORDER BY created_at DESC, message_id DESC LIMIT 100`,
      [req.userId, target],
    );
    const combined = [
      ...messages.rows.map(message => ({ ...message, kind: "text" })),
      ...voices.rows.map(message => ({ ...message, kind: "voice", body: "", reactions: [] })),
    ].sort((a,b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime()).slice(-100);
    res.json({ messages: combined });
  });

  // Request initiation is separate from sending a message. No message body is
  // accepted here and no recipient inbox is exposed to the sender.
  router.post("/creator-hub/social/message-requests", async (req, res) => {
    const parsed = targetSchema.extend({ body: z.string().trim().min(1).max(2000) }).strict().safeParse(req.body);
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
      if (accepted.rowCount) {
        await client.query("INSERT INTO echo_creator_direct_messages(sender_owner_id,recipient_owner_id,body) VALUES($1,$2,$3)", [req.userId, parsed.data.targetOwnerId, parsed.data.body]);
        await client.query("COMMIT"); res.json({ status: "accepted" }); return;
      }
      if (target.rows[0].message_privacy === "nobody") {
        await client.query("ROLLBACK"); res.status(403).json({ error: "MESSAGES_DISABLED" }); return;
      }
      if (target.rows[0].message_privacy === "everyone") {
        await client.query("INSERT INTO echo_creator_direct_messages(sender_owner_id,recipient_owner_id,body) VALUES($1,$2,$3)", [req.userId, parsed.data.targetOwnerId, parsed.data.body]);
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
        `INSERT INTO echo_creator_message_requests(sender_owner_id,recipient_owner_id,preview_body)
         VALUES($1,$2,$3) ON CONFLICT DO NOTHING`,
        [req.userId, parsed.data.targetOwnerId, parsed.data.body],
      );
      await client.query("COMMIT");
      res.json({ status: "requested" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
  });

  // A recipient-scoped inbox: never return another user's requests.
  router.get("/creator-hub/social/conversations", async (req, res) => {
    const result = await pool.query(
      `WITH peers AS (
        SELECT CASE WHEN sender_owner_id=$1 THEN recipient_owner_id ELSE sender_owner_id END AS peer_id
          FROM echo_creator_message_requests WHERE status='accepted' AND (sender_owner_id=$1 OR recipient_owner_id=$1)
        UNION
        SELECT CASE WHEN sender_owner_id=$1 THEN recipient_owner_id ELSE sender_owner_id END
          FROM echo_creator_direct_messages WHERE sender_owner_id=$1 OR recipient_owner_id=$1
        UNION
        SELECT CASE WHEN sender_owner_id=$1 THEN recipient_owner_id ELSE sender_owner_id END
          FROM echo_creator_voice_messages WHERE sender_owner_id=$1 OR recipient_owner_id=$1
      )
      SELECT p.owner_id AS "ownerId", p.display_name AS "displayName", p.username
      FROM peers JOIN echo_creator_profiles p ON p.owner_id=peers.peer_id
      WHERE NOT EXISTS (
        SELECT 1 FROM echo_creator_blocks b WHERE
        (b.blocker_owner_id=$1 AND b.blocked_owner_id=p.owner_id)
        OR (b.blocker_owner_id=p.owner_id AND b.blocked_owner_id=$1)
      ) ORDER BY p.display_name LIMIT 100`,
      [req.userId],
    );
    res.json({ conversations: result.rows });
  });

  router.get("/creator-hub/social/message-requests", async (req, res) => {
    const result = await pool.query(
      `SELECT r.id, r.sender_owner_id AS "senderOwnerId",
       p.display_name AS "displayName", p.username, r.preview_body AS "previewBody", r.created_at AS "createdAt"
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
    const client = await pool.connect();
    try {
      await client.query("BEGIN");
      const result = await client.query(
        `UPDATE echo_creator_message_requests SET status=$3, updated_at=now()
         WHERE id=$1 AND recipient_owner_id=$2 AND status='pending'
         RETURNING id, sender_owner_id, recipient_owner_id, preview_body`,
        [parsed.data.requestId, req.userId, parsed.data.action === "accept" ? "accepted" : "rejected"],
      );
      if (!result.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "REQUEST_NOT_FOUND" }); return; }
      const request = result.rows[0];
      if (parsed.data.action === "accept" && request.preview_body) {
        await client.query(
          "INSERT INTO echo_creator_direct_messages(sender_owner_id,recipient_owner_id,body) VALUES($1,$2,$3)",
          [request.sender_owner_id, request.recipient_owner_id, request.preview_body],
        );
      }
      await client.query("COMMIT");
      res.json({ status: parsed.data.action === "accept" ? "accepted" : "rejected" });
    } catch (error) { await client.query("ROLLBACK"); throw error; }
    finally { client.release(); }
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
        const blocked = await client.query(
          "SELECT 1 FROM echo_creator_blocks WHERE (blocker_owner_id=$1 AND blocked_owner_id=$2) OR (blocker_owner_id=$2 AND blocked_owner_id=$1)",
          [result.rows[0].requester_owner_id, req.userId],
        );
        if (blocked.rowCount) {
          await client.query("ROLLBACK");
          res.status(404).json({ error: "REQUEST_NOT_FOUND" });
          return;
        }
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
  const founderOwnerId = "user_3LeoBfUicTthDVixNbkPlqXFkdZ";
  const publicationSchema = z.object({
    kind: z.enum(["character","world","update","post"]),
    title: z.string().trim().min(1).max(120),
    body: z.string().max(5000).default(""),
    visibility: z.enum(["public","followers","private"]).default("private"),
    pinned: z.boolean().default(false),
    coverPath: z.string().regex(new RegExp("^/objects/uploads/[0-9a-f-]{36}$", "i")).nullable().default(null),
  }).strict();
  const readStateSchema = z.object({ ids: z.array(z.string().uuid()).max(300) }).strict();
  router.get("/creator-hub/social/notification-reads", async (req, res) => {
    const user = await clerkClient.users.getUser(req.userId!);
    const ids = user.privateMetadata?.echoCreatorNotificationReads;
    res.json({ ids: Array.isArray(ids) ? ids.filter((id): id is string => typeof id === 'string').slice(-300) : [] });
  });
  router.put("/creator-hub/social/notification-reads", async (req, res) => {
    const parsed = readStateSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_NOTIFICATION_READS" }); return; }
    const user = await clerkClient.users.getUser(req.userId!);
    const previous = user.privateMetadata?.echoCreatorNotificationReads;
    const ids = [...new Set([...(Array.isArray(previous) ? previous.filter((id): id is string => typeof id === 'string') : []), ...parsed.data.ids])].slice(-300);
    await clerkClient.users.updateUserMetadata(req.userId!, { privateMetadata: { echoCreatorNotificationReads: ids } });
    res.json({ ids });
  });
  // Account-level, one-time onboarding. No public post or social notification is created.
  router.post("/creator-hub/social/claim-welcome", async (req, res) => {
    const user = await clerkClient.users.getUser(req.userId!);
    if (user.privateMetadata?.echoWelcomeShown === true) {
      res.json({ show: false }); return;
    }
    await clerkClient.users.updateUserMetadata(req.userId!, {
      privateMetadata: { echoWelcomeShown: true },
    });
    res.json({ show: true });
  });
  const announcementPreferenceSchema = z.object({ subscribed: z.boolean() }).strict();
  router.get("/creator-hub/social/announcement-subscription", async (req, res) => {
    const user = await clerkClient.users.getUser(req.userId!);
    res.json({ subscribed: user.privateMetadata?.echoOfficialAnnouncementsSubscribed !== false });
  });
  router.put("/creator-hub/social/announcement-subscription", async (req, res) => {
    const parsed = announcementPreferenceSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_SUBSCRIPTION" }); return; }
    await clerkClient.users.updateUserMetadata(req.userId!, {
      privateMetadata: { echoOfficialAnnouncementsSubscribed: parsed.data.subscribed },
    });
    res.json({ subscribed: parsed.data.subscribed });
  });
  // Public official announcements are readable by any signed-in ECHO user.
  // The founder-only publication rule below prevents other creators from impersonating ECHO.
  // Public creator posts from accounts this member follows; private posts are never exposed.
  router.get("/creator-hub/social/following-publications", async (req, res) => {
    const result = await pool.query(
      `SELECT p.id,p.owner_id AS "ownerId",c.display_name AS "displayName",
              p.kind,p.title,p.body,p.created_at AS "createdAt"
       FROM echo_creator_publications p
       JOIN echo_creator_follows f ON f.followed_owner_id=p.owner_id AND f.follower_owner_id=$1
       JOIN echo_creator_profiles c ON c.owner_id=p.owner_id
       WHERE p.visibility='public' AND p.kind<>'update'
         AND NOT EXISTS (SELECT 1 FROM echo_creator_blocks b
           WHERE (b.blocker_owner_id=$1 AND b.blocked_owner_id=p.owner_id)
              OR (b.blocker_owner_id=p.owner_id AND b.blocked_owner_id=$1))
       ORDER BY p.created_at DESC LIMIT 50`,
      [req.userId],
    );
    res.json({ publications: result.rows });
  });
  router.get("/creator-hub/social/official-updates", async (req, res) => {
    const user = await clerkClient.users.getUser(req.userId!);
    if (user.privateMetadata?.echoOfficialAnnouncementsSubscribed === false) {
      res.json({ updates: [], subscribed: false }); return;
    }
    const result = await pool.query(
      `SELECT id,title,body,created_at AS "createdAt"
       FROM echo_creator_publications
       WHERE owner_id=$1 AND kind='update' AND visibility='public'
       ORDER BY created_at DESC LIMIT 30`,
      [founderOwnerId],
    );
    res.json({ updates: result.rows });
  });
  router.post("/creator-hub/social/publications", async (req, res) => {
    const parsed = publicationSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({error:"INVALID_PUBLICATION"}); return; }
    if (parsed.data.kind === "update" && req.userId !== founderOwnerId) { res.status(403).json({error:"OFFICIAL_UPDATES_RESTRICTED"}); return; }
    if (parsed.data.kind === "update" && parsed.data.visibility !== "public") { res.status(400).json({error:"OFFICIAL_UPDATES_MUST_BE_PUBLIC"}); return; }
    const profile = await pool.query("SELECT 1 FROM echo_creator_profiles WHERE owner_id=$1", [req.userId]);
    if (!profile.rowCount) { res.status(409).json({error:"CREATOR_PROFILE_REQUIRED"}); return; }
    const {kind,title,body,visibility,pinned,coverPath} = parsed.data;
    if (coverPath) {
      const owned = await pool.query("SELECT 1 FROM echo_media WHERE owner_id=$1 AND object_path=$2", [req.userId,coverPath]);
      if (!owned.rowCount) { res.status(400).json({error:"MEDIA_NOT_OWNED"}); return; }
    }
    const result = await pool.query(
      `INSERT INTO echo_creator_publications(owner_id,kind,title,body,visibility,pinned,cover_path)
       VALUES ($1,$2,$3,$4,$5,$6,$7)
       RETURNING id,kind,title,body,visibility,pinned,cover_path AS "coverPath",created_at AS "createdAt"`,
      [req.userId,kind,title,body,visibility,pinned,coverPath],
    );
    res.status(201).json({publication:result.rows[0]});
  });
  router.get("/creator-hub/social/publications/:ownerId", async (req, res) => {
    const ownerId = req.params.ownerId === "me" ? req.userId : req.params.ownerId;
    if (!ownerId || ownerId.length > 255) { res.status(400).json({error:"INVALID_OWNER"}); return; }
    const result = await pool.query(
      `SELECT p.id,p.kind,p.title,p.body,p.visibility,p.pinned,p.cover_path AS "coverPath",p.created_at AS "createdAt"
       FROM echo_creator_publications p
       WHERE p.owner_id=$2 AND NOT EXISTS (
         SELECT 1 FROM echo_creator_blocks b WHERE
           (b.blocker_owner_id=$1 AND b.blocked_owner_id=$2) OR
           (b.blocker_owner_id=$2 AND b.blocked_owner_id=$1)
       ) AND (p.owner_id=$1 OR p.visibility='public'
         OR (p.visibility='followers' AND EXISTS (
           SELECT 1 FROM echo_creator_follows f
           WHERE f.follower_owner_id=$1 AND f.followed_owner_id=$2
         )))
       ORDER BY p.pinned DESC,p.created_at DESC LIMIT 100`,
      [req.userId,ownerId],
    );
    res.json({publications:result.rows});
  });
  router.patch("/creator-hub/social/publications/:id", async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) { res.status(400).json({error:"INVALID_ID"}); return; }
    const parsed = publicationSchema.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({error:"INVALID_PUBLICATION"}); return; }
    if (parsed.data.kind === "update" && req.userId !== founderOwnerId) { res.status(403).json({error:"OFFICIAL_UPDATES_RESTRICTED"}); return; }
    const {kind,title,body,visibility,pinned,coverPath} = parsed.data;
    if (coverPath) {
      const owned = await pool.query("SELECT 1 FROM echo_media WHERE owner_id=$1 AND object_path=$2", [req.userId,coverPath]);
      if (!owned.rowCount) { res.status(400).json({error:"MEDIA_NOT_OWNED"}); return; }
    }
    const result = await pool.query(
      `UPDATE echo_creator_publications SET kind=$3,title=$4,body=$5,visibility=$6,pinned=$7,cover_path=$8
       WHERE id=$1 AND owner_id=$2
       RETURNING id,kind,title,body,visibility,pinned,cover_path AS "coverPath",created_at AS "createdAt"`,
      [req.params.id,req.userId,kind,title,body,visibility,pinned,coverPath],
    );
    if (!result.rowCount) { res.status(404).json({error:"PUBLICATION_NOT_FOUND"}); return; }
    res.json({publication:result.rows[0]});
  });
  router.delete("/creator-hub/social/publications/:id", async (req, res) => {
    if (!z.string().uuid().safeParse(req.params.id).success) { res.status(400).json({error:"INVALID_ID"}); return; }
    const result = await pool.query(
      "DELETE FROM echo_creator_publications WHERE id=$1 AND owner_id=$2 RETURNING id",
      [req.params.id,req.userId],
    );
    if (!result.rowCount) { res.status(404).json({error:"PUBLICATION_NOT_FOUND"}); return; }
    res.json({deleted:true});
  });
  return router;
}
export const creatorHubSocialRouter = createCreatorHubSocialRouter();
