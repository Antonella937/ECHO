import { runGroupAutonomyOnce } from "../autonomy/group-executor";
import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, echoUniversesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use("/group-dms", requireAuth);
const id = z.string().min(1).max(120);
const scope = z.object({ universeId: id.default("primary"), actorId: id });
const createBody = scope.extend({ name: z.string().trim().min(1).max(80), participantIds: z.array(id).min(2).max(31) });
const attachmentSchema = z.object({ id: z.string().min(1).max(200), type: z.enum(['image', 'video', 'audio']), url: z.string().min(1).max(2048), durationSeconds: z.number().nonnegative().optional() }).passthrough();
const sendBody = scope.extend({ text: z.string().trim().max(10000).default(''), attachments: z.array(attachmentSchema).max(5).default([]) }).refine(v => !!v.text || v.attachments.length > 0);
const asObject = (value: unknown): Record<string, unknown> | null =>
  value && typeof value === "object" && !Array.isArray(value) ? value as Record<string, unknown> : null;
const asArray = (value: unknown): string[] => Array.isArray(value) ? value.filter((v): v is string => typeof v === "string") : [];
async function getUniverse(ownerId: string, universeId: string, actorId: string) {
  const [universe] = await db.select({ state: echoUniversesTable.state, archivedAt: echoUniversesTable.archivedAt, deletedAt: echoUniversesTable.deletedAt })
    .from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId))).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) return null;
  const state = asObject(universe.state);
  const characters = Array.isArray(state?.characters) ? state.characters.map(asObject).filter((c): c is Record<string, unknown> => !!c) : [];
  if (!characters.some(c => c.id === actorId && c.archived !== true)) return null;
  return characters;
}
const serializeGroup = (row: Record<string, unknown>) => ({
  id: row.id, name: row.name, avatar: row.avatar, createdBy: row.created_by, muted: row.muted === true, archived: row.archived === true,
  participantIds: row.participant_ids, createdAt: row.created_at, updatedAt: row.updated_at,
});
router.get("/group-dms", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT g.id, g.name, g.avatar, g.created_by, g.participant_ids, g.created_at, g.updated_at,
    COALESCE(p.muted, false) AS muted, COALESCE(p.archived, false) AS archived
    FROM echo_group_conversations g LEFT JOIN echo_group_member_preferences p
      ON p.owner_id = g.owner_id AND p.universe_id = g.universe_id AND p.group_id = g.id AND p.actor_id = ${actorId}
    WHERE g.owner_id = ${req.userId!} AND g.universe_id = ${universeId}
    AND (g.participant_ids ? ${actorId} OR g.scene_observer_enabled=true) ORDER BY g.updated_at DESC LIMIT 100`);
  res.json({ groups: result.rows.map(row => serializeGroup(row as Record<string, unknown>)) });
});
router.post("/group-dms", async (req, res) => {
  const parsed = createBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_GROUP" }); return; }
  const { universeId, actorId, name, participantIds } = parsed.data;
  const characters = await getUniverse(req.userId!, universeId, actorId);
  if (!characters) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const members = [...new Set([actorId, ...participantIds])];
  if (members.length < 3 || members.length > 32 || members.some(member => !characters.some(c => c.id === member && c.archived !== true))) {
    res.status(422).json({ error: "INVALID_PARTICIPANTS" }); return;
  }
  const groupId = `group_${randomUUID()}`;
  await db.execute(sql`INSERT INTO echo_group_conversations
    (owner_id, universe_id, id, name, created_by, participant_ids)
    VALUES (${req.userId!}, ${universeId}, ${groupId}, ${name}, ${actorId}, ${JSON.stringify(members)}::jsonb)`);
  res.status(201).json({ id: groupId, name, participantIds: members });
});
router.get("/group-dms/:groupId/messages", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const groupId = String(req.params.groupId);
  const group = await db.execute(sql`SELECT id FROM echo_group_conversations
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}
    AND (participant_ids ? ${actorId} OR scene_observer_enabled=true) LIMIT 1`);
  if (!group.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  const messages = await db.execute(sql`SELECT id, group_id AS "groupId", sender_id AS "senderId",
    body AS text, attachments, read_by AS "readBy", quote_message_id AS "quoteMessageId", pinned_at AS "pinnedAt", pinned_by AS "pinnedBy",
    created_at AS "createdAt" FROM echo_group_messages
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND group_id = ${groupId}
    ORDER BY created_at DESC LIMIT 100`);
  res.json({ messages: [...messages.rows].reverse() });
});
router.post("/group-dms/:groupId/messages", async (req, res) => {
  const parsed = sendBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_MESSAGE" }); return; }
  const { universeId, actorId, text, attachments } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const groupId = String(req.params.groupId);
  const messageId = randomUUID();
  const inserted = await db.execute(sql`INSERT INTO echo_group_messages
    (owner_id, universe_id, id, group_id, sender_id, body, attachments, read_by)
    SELECT ${req.userId!}, ${universeId}, ${messageId}, id, ${actorId}, ${text}, ${JSON.stringify(attachments)}::jsonb, ${JSON.stringify([actorId])}::jsonb
    FROM echo_group_conversations
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}
    AND participant_ids ? ${actorId} RETURNING id, created_at`);
  if (!inserted.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  await db.execute(sql`UPDATE echo_group_conversations SET updated_at = now()
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}`);
  res.status(201).json({ id: messageId, groupId, senderId: actorId, text, attachments, createdAt: inserted.rows[0].created_at });
});
// Share an explicitly published ECHO Music track into a group conversation.
// The track is referenced, never regenerated or copied. Group membership and
// track publication are verified server-side before delivery.
const groupMusicBody = scope.extend({ trackId: z.string().uuid() });
router.post("/group-dms/:groupId/music", async (req, res) => {
  const parsed = groupMusicBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) {
    res.status(400).json({ error: "INVALID_GROUP_MUSIC" }); return;
  }
  const { universeId, actorId, trackId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) {
    res.status(403).json({ error: "INVALID_IDENTITY" }); return;
  }
  const groupId = String(req.params.groupId);
  try {
    const track = await db.execute(sql`
      SELECT id,title,duration_seconds FROM echo_music_library
      WHERE owner_id=${req.userId!} AND id=${trackId}
        AND published_at IS NOT NULL AND status='saved_audio'
        AND audio_path IS NOT NULL LIMIT 1
    `);
    if (!track.rows.length) { res.status(404).json({ error: "MUSIC_NOT_PUBLISHED" }); return; }
    const title = String(track.rows[0].title);
    const durationSeconds = Number(track.rows[0].duration_seconds);
    const attachment = { id: randomUUID(), type: 'music', trackId, title, durationSeconds };
    const messageId = randomUUID();
    const inserted = await db.execute(sql`
      INSERT INTO echo_group_messages
        (owner_id,universe_id,id,group_id,sender_id,body,attachments,read_by)
      SELECT ${req.userId!},${universeId},${messageId},id,${actorId},'',
        ${JSON.stringify([attachment])}::jsonb,${JSON.stringify([actorId])}::jsonb
      FROM echo_group_conversations
      WHERE owner_id=${req.userId!} AND universe_id=${universeId}
        AND id=${groupId} AND participant_ids ? ${actorId}
      RETURNING id,created_at
    `);
    if (!inserted.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
    await db.execute(sql`UPDATE echo_group_conversations SET updated_at=now()
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId}`);
    res.status(201).json({ id: messageId, trackId, attachment, creditsUsed: 0, createdAt: inserted.rows[0].created_at });
  } catch (error) {
    req.log.error({ err: error }, "Group music delivery failed");
    res.status(503).json({ error: "GROUP_MUSIC_UNAVAILABLE" });
  }
});
router.post("/group-dms/:groupId/music/:trackId/save", async (req, res) => {
  const parsed = scope.safeParse(req.body);
  const trackId = z.string().uuid().safeParse(req.params.trackId);
  if (!parsed.success || !trackId.success || !id.safeParse(req.params.groupId).success) {
    res.status(400).json({ error: "INVALID_GROUP_MUSIC_SAVE" }); return;
  }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) {
    res.status(403).json({ error: "INVALID_IDENTITY" }); return;
  }
  try {
    const result = await db.execute(sql`
      INSERT INTO echo_music_character_saves (owner_id,track_id,character_id)
      SELECT ${req.userId!},l.id,${actorId}
      FROM echo_music_library l
      WHERE l.owner_id=${req.userId!} AND l.id=${trackId.data}
        AND l.status='saved_audio' AND l.audio_path IS NOT NULL
        AND EXISTS (
          SELECT 1 FROM echo_group_conversations g
          JOIN echo_group_messages m ON m.owner_id=g.owner_id
            AND m.universe_id=g.universe_id AND m.group_id=g.id
          WHERE g.owner_id=${req.userId!} AND g.universe_id=${universeId}
            AND g.id=${String(req.params.groupId)} AND g.participant_ids ? ${actorId}
            AND EXISTS (
              SELECT 1 FROM jsonb_array_elements(m.attachments) a
              WHERE a->>'type'='music' AND a->>'trackId'=${trackId.data}
            )
        )
      ON CONFLICT (owner_id,track_id,character_id) DO NOTHING
      RETURNING track_id
    `);
    if (!result.rows.length) {
      const exists = await db.execute(sql`
        SELECT 1 FROM echo_music_character_saves WHERE owner_id=${req.userId!}
          AND track_id=${trackId.data} AND character_id=${actorId}
      `);
      if (!exists.rows.length) { res.status(403).json({ error: "MUSIC_NOT_SHARED_WITH_CHARACTER" }); return; }
    }
    res.json({ saved: true, reusedExistingAudio: true, creditsUsed: 0 });
  } catch (error) {
    req.log.error({ err: error }, "Group music save failed");
    res.status(503).json({ error: "GROUP_MUSIC_SAVE_UNAVAILABLE" });
  }
});
const editBody = scope.extend({ name: z.string().trim().min(1).max(80) });
router.patch("/group-dms/:groupId", async (req, res) => {
  const parsed = editBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_GROUP" }); return; }
  const { universeId, actorId, name } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`UPDATE echo_group_conversations SET name = ${name}, updated_at = now()
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${String(req.params.groupId)}
    AND participant_ids ? ${actorId} RETURNING id, name`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ group: result.rows[0] });
});
router.post("/group-dms/:groupId/leave", async (req, res) => {
  const parsed = scope.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_GROUP" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`UPDATE echo_group_conversations
    SET participant_ids = participant_ids - ${actorId}, updated_at = now()
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${String(req.params.groupId)}
    AND participant_ids ? ${actorId} RETURNING id`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ left: true });
});
const addMembersBody = scope.extend({ participantIds: z.array(id).min(1).max(31) });
router.post("/group-dms/:groupId/participants", async (req, res) => {
  const parsed = addMembersBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_PARTICIPANTS" }); return; }
  const { universeId, actorId, participantIds } = parsed.data;
  const characters = await getUniverse(req.userId!, universeId, actorId);
  if (!characters) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  if (participantIds.some(member => !characters.some(c => c.id === member && c.archived !== true))) {
    res.status(422).json({ error: "UNKNOWN_PARTICIPANT" }); return;
  }
  const groupId = String(req.params.groupId);
  const current = await db.execute(sql`SELECT participant_ids FROM echo_group_conversations
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}
    AND participant_ids ? ${actorId} LIMIT 1`);
  if (!current.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  const merged = [...new Set([...asArray(current.rows[0].participant_ids), ...participantIds])];
  if (merged.length > 32) { res.status(422).json({ error: "GROUP_PARTICIPANT_LIMIT" }); return; }
  const result = await db.execute(sql`UPDATE echo_group_conversations SET participant_ids = ${JSON.stringify(merged)}::jsonb, updated_at = now()
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}
    AND participant_ids ? ${actorId} RETURNING participant_ids`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ participantIds: result.rows[0].participant_ids });
});
const avatarBody = scope.extend({ avatar: z.string().min(1).max(2048).refine(v => v.startsWith('https://') || !v.includes('://'), 'INVALID_AVATAR_PATH').nullable() });
router.patch("/group-dms/:groupId/avatar", async (req, res) => {
  const parsed = avatarBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_AVATAR" }); return; }
  const { universeId, actorId, avatar } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`UPDATE echo_group_conversations SET avatar = ${avatar}, updated_at = now()
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${String(req.params.groupId)}
    AND participant_ids ? ${actorId} RETURNING avatar`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ avatar: result.rows[0].avatar });
});
router.get("/group-dms/:groupId/autonomy", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT autonomy_enabled, autonomy_interval_minutes FROM echo_group_conversations
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${String(req.params.groupId)}
    AND (participant_ids ? ${actorId} OR scene_observer_enabled=true) LIMIT 1`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ enabled: result.rows[0].autonomy_enabled, intervalMinutes: result.rows[0].autonomy_interval_minutes });
});
const groupAutonomyBody = scope.extend({ enabled: z.boolean(), intervalMinutes: z.number().int().min(15).max(1440).default(60) });
router.patch("/group-dms/:groupId/autonomy", async (req, res) => {
  const parsed = groupAutonomyBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_AUTONOMY_SETTINGS" }); return; }
  const { universeId, actorId, enabled, intervalMinutes } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`UPDATE echo_group_conversations
    SET autonomy_enabled = ${enabled}, autonomy_interval_minutes = ${intervalMinutes}, updated_at = now()
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${String(req.params.groupId)}
    AND (participant_ids ? ${actorId} OR scene_observer_enabled=true) RETURNING autonomy_enabled, autonomy_interval_minutes`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ enabled: result.rows[0].autonomy_enabled, intervalMinutes: result.rows[0].autonomy_interval_minutes });
});
const sceneBody = scope.extend({
  context: z.string().max(10000),
  turnMode: z.enum(["automatic", "round_robin", "manual"]),
  responseSpeed: z.enum(["immediate", "normal", "slow"]),
  observerEnabled: z.boolean(),
});
router.get("/group-dms/:groupId/scene", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_SCENE_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT scene_context AS "context", scene_turn_mode AS "turnMode",
    scene_response_speed AS "responseSpeed", scene_observer_enabled AS "observerEnabled"
    FROM echo_group_conversations WHERE owner_id=${req.userId!} AND universe_id=${universeId}
    AND id=${String(req.params.groupId)} AND (participant_ids ? ${actorId} OR scene_observer_enabled=true) LIMIT 1`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json(result.rows[0]);
});
router.patch("/group-dms/:groupId/scene", async (req, res) => {
  const parsed = sceneBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_SCENE" }); return; }
  const { universeId, actorId, context, turnMode, responseSpeed, observerEnabled } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`UPDATE echo_group_conversations
    SET scene_context=${context}, scene_turn_mode=${turnMode}, scene_response_speed=${responseSpeed},
      scene_observer_enabled=${observerEnabled}, updated_at=now()
    WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${String(req.params.groupId)}
    AND (participant_ids ? ${actorId} OR scene_observer_enabled=true)
    RETURNING scene_context AS "context", scene_turn_mode AS "turnMode",
      scene_response_speed AS "responseSpeed", scene_observer_enabled AS "observerEnabled"`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json(result.rows[0]);
});
router.post("/group-dms/:groupId/scene/next", async (req, res) => {
  const parsed = scope.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_SCENE_TURN" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const groupId = String(req.params.groupId);
  const allowed = await db.execute(sql`SELECT id FROM echo_group_conversations
    WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId}
      AND scene_observer_enabled=true AND autonomy_enabled=true LIMIT 1`);
  if (!allowed.rows.length) { res.status(403).json({ error: "SCENE_NOT_ENABLED" }); return; }
  try {
    const result = await runGroupAutonomyOnce(req.userId!, universeId, groupId, true);
    res.json(result);
  } catch (error) {
    req.log.error({ err: error }, "Group scene turn failed");
    res.status(503).json({ error: "SCENE_TURN_UNAVAILABLE" });
  }
});
const pinBody = scope.extend({ pinned: z.boolean() });
router.patch("/group-dms/:groupId/messages/:messageId/pin", async (req, res) => {
  const parsed = pinBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success || !id.safeParse(req.params.messageId).success) {
    res.status(400).json({ error: "INVALID_PIN_REQUEST" }); return;
  }
  const { universeId, actorId, pinned } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`UPDATE echo_group_messages SET pinned_at = CASE WHEN ${pinned} THEN now() ELSE NULL END,
    pinned_by = CASE WHEN ${pinned} THEN ${actorId} ELSE NULL END
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId}
    AND group_id = ${String(req.params.groupId)} AND id = ${String(req.params.messageId)}
    AND EXISTS (SELECT 1 FROM echo_group_conversations g WHERE g.owner_id = ${req.userId!}
      AND g.universe_id = ${universeId} AND g.id = ${String(req.params.groupId)} AND g.participant_ids ? ${actorId})
    RETURNING id, pinned_at AS "pinnedAt", pinned_by AS "pinnedBy"`);
  if (!result.rows.length) { res.status(404).json({ error: "MESSAGE_NOT_FOUND" }); return; }
  res.json({ message: result.rows[0] });
});
router.get("/group-dms/:groupId/search", async (req, res) => {
  const parsed = scope.extend({ q: z.string().trim().min(1).max(120) }).safeParse(req.query);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_SEARCH" }); return; }
  const { universeId, actorId, q } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT m.id, m.sender_id AS "senderId", m.body AS text, m.created_at AS "createdAt"
    FROM echo_group_messages m JOIN echo_group_conversations g ON
      g.owner_id = m.owner_id AND g.universe_id = m.universe_id AND g.id = m.group_id
    WHERE m.owner_id = ${req.userId!} AND m.universe_id = ${universeId}
      AND m.group_id = ${String(req.params.groupId)} AND g.participant_ids ? ${actorId}
      AND m.body ILIKE ('%' || ${q} || '%')
    ORDER BY m.created_at DESC LIMIT 50`);
  res.json({ messages: result.rows });
});
const preferencesBody = scope.extend({ muted: z.boolean().optional(), archived: z.boolean().optional() }).refine(v => v.muted !== undefined || v.archived !== undefined);
router.get("/group-dms/:groupId/preferences", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT p.muted, p.archived FROM echo_group_conversations g
    LEFT JOIN echo_group_member_preferences p ON p.owner_id = g.owner_id AND p.universe_id = g.universe_id AND p.group_id = g.id AND p.actor_id = ${actorId}
    WHERE g.owner_id = ${req.userId!} AND g.universe_id = ${universeId} AND g.id = ${String(req.params.groupId)}
      AND (g.participant_ids ? ${actorId} OR g.scene_observer_enabled=true) LIMIT 1`);
  if (!result.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ muted: result.rows[0].muted === true, archived: result.rows[0].archived === true });
});
router.patch("/group-dms/:groupId/preferences", async (req, res) => {
  const parsed = preferencesBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_PREFERENCES" }); return; }
  const { universeId, actorId, muted, archived } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const groupId = String(req.params.groupId);
  const membership = await db.execute(sql`SELECT id FROM echo_group_conversations
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}
      AND participant_ids ? ${actorId} LIMIT 1`);
  if (!membership.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  const result = await db.execute(sql`INSERT INTO echo_group_member_preferences
    (owner_id, universe_id, group_id, actor_id, muted, archived)
    VALUES (${req.userId!}, ${universeId}, ${groupId}, ${actorId}, ${muted ?? false}, ${archived ?? false})
    ON CONFLICT (owner_id, universe_id, group_id, actor_id)
    DO UPDATE SET muted = COALESCE(${muted ?? null}::boolean, echo_group_member_preferences.muted),
      archived = COALESCE(${archived ?? null}::boolean, echo_group_member_preferences.archived),
      updated_at = now()
    RETURNING muted, archived`);
  res.json(result.rows[0]);
});
export default router;
