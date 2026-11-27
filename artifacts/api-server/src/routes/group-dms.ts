import { describeGroupAttachment } from "../vision/service";
import { sendKindroidSocialGroupContext } from "../ai-engine/kindroid-social-group";
import { notifyNewGroupMessage } from "../lib/group-push-dispatch";
import { privateConversationCandidates } from "../lib/canon-knowledge";
import { runGroupAutonomyOnce } from "../autonomy/group-executor";
import { randomUUID, createHash } from "node:crypto";
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
  id: row.id, name: row.name, avatar: row.avatar, wallpaperUrl: row.wallpaper_url ?? null, createdBy: row.created_by, muted: row.muted === true, archived: row.archived === true,
  participantIds: row.participant_ids, kindroidGroupId: row.kindroid_group_id ?? null, unreadCount: Number(row.unread_count ?? 0), createdAt: row.created_at, updatedAt: row.updated_at,
});
router.get("/group-dms", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT g.id, g.name, g.avatar, g.wallpaper_url, g.kindroid_group_id, g.created_by, g.participant_ids, g.created_at, g.updated_at,
    COALESCE(p.muted, false) AS muted, COALESCE(p.archived, false) AS archived,
    (SELECT count(*)::integer FROM echo_group_messages m WHERE m.owner_id=g.owner_id AND m.universe_id=g.universe_id AND m.group_id=g.id AND m.sender_id <> ${actorId} AND NOT (COALESCE(m.read_by,'[]'::jsonb) ? ${actorId})) AS unread_count
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
// Any new participant or observer group can be linked to its Kindroid group.
router.put("/group-dms/:groupId/kindroid-link", async (req, res) => {
  const parsed = scope.extend({ kindroidGroupId: z.string().regex(/^[a-zA-Z0-9_-]{10,120}$/).nullable() }).safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) {res.status(400).json({error:"INVALID_KINDROID_GROUP"});return;}
  const {universeId,actorId,kindroidGroupId}=parsed.data;
  if (!await getUniverse(req.userId!,universeId,actorId)) {res.status(403).json({error:"INVALID_IDENTITY"});return;}
  const groupId=String(req.params.groupId);
  const result=await db.execute(sql`UPDATE echo_group_conversations SET kindroid_group_id=${kindroidGroupId},updated_at=now()
    WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId}
    AND (created_by=${actorId} OR participant_ids ? ${actorId}) RETURNING id`);
  if (!result.rows.length) {res.status(404).json({error:"GROUP_NOT_FOUND"});return;}
  res.json({kindroidGroupId});
});
// Group appearance is stored centrally, so it follows the group across devices.
router.put("/group-dms/:groupId/wallpaper", async (req, res) => {
  const parsed = scope.extend({ wallpaperUrl: z.union([z.string().url().max(2048), z.string().regex(/^\/(?:objects|api\/storage\/objects)\/[a-zA-Z0-9/_-]+$/).max(2048)]).nullable() }).safeParse({
    ...req.body, universeId: req.body?.universeId, actorId: req.body?.actorId,
  });
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_WALLPAPER" }); return; }
  const { universeId, actorId, wallpaperUrl } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const groupId = String(req.params.groupId);
  const updated = await db.execute(sql`UPDATE echo_group_conversations
    SET wallpaper_url=${wallpaperUrl}, updated_at=now()
    WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId}
    AND (participant_ids ? ${actorId} OR created_by=${actorId})
    RETURNING wallpaper_url`);
  if (!updated.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  res.json({ wallpaperUrl: updated.rows[0].wallpaper_url });
});
router.put("/group-dms/push-preference", async (req, res) => {
  const parsed = z.object({ enabled: z.boolean() }).safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"INVALID_PREFERENCE"});return; }
  const { clerkClient } = await import("@clerk/express");
  await clerkClient.users.updateUserMetadata(req.userId!, {
    privateMetadata: { echoGroupPushEnabled: parsed.data.enabled },
  });
  res.json({ enabled: parsed.data.enabled });
});
// Read-only Kindroid history reconciliation. Never requests AI generation.
const kindroidHistoryLastCheck = new Map<string, number>();
const kindroidHistoryPending = new Map<string, Promise<void>>();
// A provider-wide 429 must pause ALL history readers, including UI-triggered reads.
// This does not delay DM generation or mutate any Kindroid conversation.
const kindroidHistoryCursors = new Map<string, number>();
const KINDROID_HISTORY_POLL_MS = 2 * 60_000;
let kindroidHistoryRateLimitedUntil = 0;
const KINDROID_HISTORY_RATE_LIMIT_BACKOFF_MS = 5 * 60_000;
export async function reconcileKindroidGroupHistory(ownerId: string, universeId: string, groupId: string) {
  if (universeId !== "primary") return;
  if (Date.now() < kindroidHistoryRateLimitedUntil) return;
  const apiKey = process.env.ECHO_KINDROID_API_KEY;
  if (!apiKey) return;
  const cacheKey = ownerId + ":" + universeId + ":" + groupId;
  const pending = kindroidHistoryPending.get(cacheKey);
  if (pending) return pending;
  if (Date.now() - (kindroidHistoryLastCheck.get(cacheKey) ?? 0) < KINDROID_HISTORY_POLL_MS) return;
  kindroidHistoryLastCheck.set(cacheKey, Date.now());
  const task = (async () => {
    const group = await db.execute(sql`SELECT participant_ids, kindroid_group_id FROM echo_group_conversations
      WHERE owner_id=${ownerId} AND universe_id=${universeId} AND id=${groupId} LIMIT 1`);
    const members = group.rows[0]?.participant_ids;
    const groupIdOnKindroid = String(group.rows[0]?.kindroid_group_id ?? "");
    if (!/^[a-zA-Z0-9_-]{10,120}$/.test(groupIdOnKindroid) || !Array.isArray(members)) return;
    const links = await db.execute(sql`SELECT character_id, kin_id FROM echo_kindroid_character_links
      WHERE owner_id=${ownerId} AND universe_id=${universeId} AND enabled=true`);
    const byKin = new Map<string, string>();
    const characterNames = await db.execute(sql`SELECT character->>'id' AS id, character->>'name' AS name FROM echo_universes u, jsonb_array_elements(u.state->'characters') character WHERE u.owner_id=${ownerId} AND u.universe_id=${universeId}`);
    const byName = new Map<string, string>();
    const duplicateNames = new Set<string>();
    for (const character of characterNames.rows) {
      const characterId = String(character.id ?? "");
      const name = String(character.name ?? "").trim().toLowerCase();
      if (!members.includes(characterId) || !name) continue;
      if (byName.has(name)) duplicateNames.add(name);
      else byName.set(name, characterId);
    }
    for (const name of duplicateNames) byName.delete(name);
    for (const link of links.rows) {
      const characterId = String(link.character_id ?? "");
      const kinId = String(link.kin_id ?? "");
      if (members.includes(characterId) && kinId) byKin.set(kinId, characterId);
    }
    const cursorKey = cacheKey + ":" + groupIdOnKindroid;
    let cursor = kindroidHistoryCursors.get(cursorKey);
    for (let page = 0; page < 5; page++) {
      const url = new URL("https://api.kindroid.ai/v1/get-chat-messages");
      url.searchParams.set("group_id", groupIdOnKindroid);
      url.searchParams.set("limit", "100");
      if (cursor !== undefined) url.searchParams.set("start_after_timestamp", String(cursor));
      const response = await fetch(url, {
        headers: { Authorization: `Bearer ${apiKey}` },
        signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) {
        if (response.status === 429) {
          const retryAfter = response.headers.get("retry-after");
          const seconds = retryAfter && /^\d+$/.test(retryAfter.trim()) ? Number(retryAfter.trim()) : NaN;
          const retryDate = retryAfter && !Number.isFinite(seconds) ? Date.parse(retryAfter) : NaN;
          const delay = Number.isFinite(seconds) ? seconds * 1000 : Number.isFinite(retryDate) ? retryDate - Date.now() : KINDROID_HISTORY_RATE_LIMIT_BACKOFF_MS;
          kindroidHistoryRateLimitedUntil = Math.max(kindroidHistoryRateLimitedUntil, Date.now() + Math.max(KINDROID_HISTORY_RATE_LIMIT_BACKOFF_MS, Math.min(delay, 60 * 60_000)));
        }
        console.warn("[kindroid-group] history read failed", { status: response.status, group: groupId === "group_kindroid_dead_static" ? "dead_static" : "other" });
        return;
      }
      const payload: unknown = await response.json();
      if (!payload || typeof payload !== "object") return;
      const data = payload as { messages?: unknown; pagination?: { hasMore?: boolean; lastTimestamp?: number } };
      if (!Array.isArray(data.messages)) { console.warn("[kindroid-group] unsupported history payload", { group: groupId === "group_kindroid_dead_static" ? "dead_static" : "other", topLevel: Object.keys(data).slice(0,12) }); return; }
      console.info("[kindroid-group] history schema " + JSON.stringify({ group: groupId === "group_kindroid_dead_static" ? "dead_static" : "other", count: data.messages.length, fields: data.messages.length && data.messages[0] && typeof data.messages[0] === "object" ? Object.keys(data.messages[0]).slice(0,20) : [], senderMatchesKin: data.messages.length && data.messages[0] && typeof data.messages[0] === "object" ? byKin.has(String((data.messages[0] as Record<string,unknown>).sender ?? "")) : false, senderType: data.messages.length && data.messages[0] && typeof data.messages[0] === "object" ? typeof (data.messages[0] as Record<string,unknown>).sender : "none" }));
      let accepted = 0;
      const rejected = { missingId: 0, unmatchedSender: 0, missingBody: 0, badTimestamp: 0 };
      for (const raw of data.messages) {
        if (!raw || typeof raw !== "object") continue;
        const item = raw as Record<string, unknown>;
        const sourceId = typeof item.id === "string" || typeof item.id === "number" ? String(item.id) : "";
        const sender = typeof item.sender === "string" ? item.sender : "";
        const displayName = typeof item.display_name === "string" ? item.display_name.trim().toLowerCase() : "";
        const senderType = String(item.sender_type ?? sender).toLowerCase();
        if (senderType === "user" || senderType === "human") continue;
        const senderId = byKin.get(sender) ?? (displayName ? byName.get(displayName) : undefined);
        const body = typeof item.message === "string" ? item.message.trim() : "";
        const timestamp = typeof item.timestamp === "number" || (typeof item.timestamp === "string" && item.timestamp.trim()) ? Number(item.timestamp) : NaN;
        if (!sourceId) { rejected.missingId++; continue; }
        if (!senderId) { rejected.unmatchedSender++; continue; }
        if (!body || body.length > 10000) { rejected.missingBody++; continue; }
        if (!Number.isFinite(timestamp)) { rejected.badTimestamp++; continue; }
        const date = new Date(timestamp < 1e11 ? timestamp * 1000 : timestamp);
        if (!Number.isFinite(date.getTime())) { rejected.badTimestamp++; continue; }
        const stableId = "kindroid_" + createHash("sha256").update(groupIdOnKindroid + ":" + sourceId).digest("hex").slice(0, 48);
        // The live response may already exist under an ECHO UUID.
        const existing = await db.execute(sql`SELECT id FROM echo_group_messages
          WHERE owner_id=${ownerId} AND universe_id=${universeId} AND group_id=${groupId}
          AND sender_id=${senderId} AND body=${body}
          AND id NOT LIKE 'kindroid_%'
          AND abs(extract(epoch from (created_at - ${date.toISOString()}::timestamptz))) < 90
          LIMIT 1`);
        if (existing.rows.length) continue;
        // Older live group replies were forcibly truncated at 800 characters.
        // When Kindroid has the complete original, restore that exact message
        // instead of importing a second copy of the same turn.
        if (body.length > 800) {
          const truncated = await db.execute(sql`SELECT id FROM echo_group_messages
            WHERE owner_id=${ownerId} AND universe_id=${universeId} AND group_id=${groupId}
              AND sender_id=${senderId} AND id NOT LIKE 'kindroid_%' AND length(body)=800
              AND body=left(${body}, 800)
              AND abs(extract(epoch from (created_at - ${date.toISOString()}::timestamptz))) < 600
            ORDER BY created_at DESC LIMIT 1`);
          if (truncated.rows.length) {
            await db.execute(sql`UPDATE echo_group_messages SET body=${body}
              WHERE owner_id=${ownerId} AND universe_id=${universeId}
                AND id=${String(truncated.rows[0].id)} AND length(body)=800`);
            continue;
          }
        }
        const imported = await db.execute(sql`INSERT INTO echo_group_messages
          (owner_id, universe_id, id, group_id, sender_id, body, read_by, created_at)
          VALUES (${ownerId}, ${universeId}, ${stableId}, ${groupId}, ${senderId}, ${body}, '[]'::jsonb, ${date.toISOString()}::timestamptz)
          ON CONFLICT DO NOTHING RETURNING id`);
        if (imported.rows.length) {
          accepted++;
          if (Math.abs(Date.now()-date.getTime()) < 120_000) void notifyNewGroupMessage({ownerId,universeId,groupId,senderId,messageId:stableId,createdAt:date}).catch(()=>{});
        }
      }
      console.info("[kindroid-group] history counts " + JSON.stringify({ group: groupId === "group_kindroid_dead_static" ? "dead_static" : "other", page, total: data.messages.length, accepted, rejected }));
      const nextCursor = data.pagination?.lastTimestamp;
      if (typeof nextCursor !== "number" || !Number.isFinite(nextCursor) || (cursor !== undefined && nextCursor <= cursor)) break;
      kindroidHistoryCursors.set(cursorKey, nextCursor);
      cursor = nextCursor;
      if (!data.pagination?.hasMore) break;
    }
  })().catch(error => {
    console.warn("[kindroid-group] history reconciliation failed", { error: error instanceof Error ? error.name : "unknown" });
  }).finally(() => { kindroidHistoryPending.delete(cacheKey); });
  kindroidHistoryPending.set(cacheKey, task);
  return task;
}
/** Poll only the founder's already-linked Kindroid groups. Never generates a turn. */
export async function reconcileActiveKindroidGroups() {
  const ownerId = "user_3LeoBfUicTthDVixNbkPlqXFkdZ";
  const universeId = "primary";
  const groups = await db.execute(sql`SELECT id FROM echo_group_conversations
    WHERE owner_id=${ownerId} AND universe_id=${universeId} AND kindroid_group_id IS NOT NULL`);
  for (const row of groups.rows) {
    const groupId = String(row.id);
    await reconcileKindroidGroupHistory(ownerId, universeId, groupId);
  }
}
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
  await reconcileKindroidGroupHistory(req.userId!, universeId, groupId);
  const messages = await db.execute(sql`SELECT id, group_id AS "groupId", sender_id AS "senderId",
    body AS text, attachments, read_by AS "readBy", quote_message_id AS "quoteMessageId", pinned_at AS "pinnedAt", pinned_by AS "pinnedBy",
    created_at AS "createdAt" FROM echo_group_messages
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND group_id = ${groupId}
    ORDER BY created_at DESC LIMIT 100`);
  res.json({ messages: [...messages.rows].reverse() });
});
// Mark only the current participant's messages as read; spectator views do not clear badges.
router.put("/group-dms/:groupId/read", async (req, res) => {
  const parsed = scope.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({error:"INVALID_QUERY"});return; }
  const {universeId,actorId}=parsed.data;
  if (!await getUniverse(req.userId!,universeId,actorId)) {res.status(403).json({error:"INVALID_IDENTITY"});return;}
  const groupId=String(req.params.groupId);
  const group=await db.execute(sql`SELECT id FROM echo_group_conversations WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId} AND participant_ids ? ${actorId} LIMIT 1`);
  if (!group.rows.length) {res.status(404).json({error:"GROUP_NOT_FOUND"});return;}
  await db.execute(sql`UPDATE echo_group_messages SET read_by=COALESCE(read_by,'[]'::jsonb) || jsonb_build_array(${actorId}::text)
    WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND group_id=${groupId}
    AND sender_id <> ${actorId} AND NOT (COALESCE(read_by,'[]'::jsonb) ? ${actorId})`);
  res.json({ok:true});
});
// Review-only suggestions: group conversation events are never published as global canon.
router.get("/group-dms/:groupId/canon-candidates", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  const groupId = id.safeParse(req.params.groupId);
  if (!parsed.success || !groupId.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const [identity] = await db.select({ state: echoUniversesTable.state }).from(echoUniversesTable)
    .where(and(eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId))).limit(1);
  if ((identity?.state as { currentCharacterId?: string } | null)?.currentCharacterId !== actorId) {
    res.status(403).json({ error: "GROUP_VIEWER_IDENTITY_MISMATCH" }); return;
  }
  try {
    const groups = await db.execute(sql`SELECT participant_ids AS "participantIds" FROM echo_group_conversations
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId.data}
      AND participant_ids ? ${actorId} LIMIT 1`);
    const members = groups.rows[0]?.participantIds;
    if (!Array.isArray(members) || !members.includes(actorId)) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
    const messages = await db.execute(sql`SELECT id, sender_id AS "senderId", body AS text,
      created_at AS "createdAt" FROM echo_group_messages WHERE owner_id=${req.userId!}
      AND universe_id=${universeId} AND group_id=${groupId.data}
      ORDER BY created_at DESC LIMIT 100`);
    const setup = (identity?.state?.creatorSetup ?? {}) as Record<string,unknown>;
    const entries = Array.isArray(setup.canonKnowledgeEvents) ? setup.canonKnowledgeEvents : [];
    const dismissed = Array.isArray(setup.dismissedCanonEventIds) ? setup.dismissedCanonEventIds : [];
    const candidates = privateConversationCandidates([...messages.rows].reverse(), members.filter((x): x is string => typeof x === "string"))
      .filter(candidate => {
        const key = `group:${groupId.data}:${candidate.sourceId}`;
        return !dismissed.includes(key) && !entries.some(row =>
          row && typeof row==="object" && (row as Record<string,unknown>).sourceKey===key);
      });
    res.json({ candidates });
  } catch { res.status(503).json({ error: "GROUP_CANON_CANDIDATES_UNAVAILABLE" }); }
});
const groupCanonDecision = scope.extend({
  messageId: id, action: z.enum(["approve","dismiss"]),
  text: z.string().trim().min(1).max(1200).optional(),
}).strict();
router.post("/group-dms/:groupId/canon-candidates/decision", async (req, res) => {
  const groupId = id.safeParse(req.params.groupId);
  const input = groupCanonDecision.safeParse(req.body);
  if (!groupId.success || !input.success) { res.status(400).json({error:"INVALID_CANON_DECISION"}); return; }
  const { universeId, actorId, messageId, action, text } = input.data;
  try {
    const result = await db.transaction(async tx => {
      const [universe] = await tx.select().from(echoUniversesTable)
        .where(and(eq(echoUniversesTable.ownerId,req.userId!),eq(echoUniversesTable.universeId,universeId)))
        .for("update").limit(1);
      if (!universe || universe.archivedAt || universe.deletedAt) return {status:404,error:"UNIVERSE_NOT_FOUND"};
      const state = universe.state;
      if (state.currentCharacterId !== actorId) return {status:403,error:"GROUP_VIEWER_IDENTITY_MISMATCH"};
      const groups = await tx.execute(sql`SELECT participant_ids AS "participantIds" FROM echo_group_conversations
        WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId.data}
        AND participant_ids ? ${actorId} LIMIT 1`);
      const members = groups.rows[0]?.participantIds;
      if (!Array.isArray(members) || !members.includes(actorId)) return {status:404,error:"GROUP_NOT_FOUND"};
      const rows = await tx.execute(sql`SELECT id,sender_id AS "senderId",body AS text,created_at AS "createdAt"
        FROM echo_group_messages WHERE owner_id=${req.userId!} AND universe_id=${universeId}
        AND group_id=${groupId.data} AND id=${messageId} LIMIT 1`);
      const candidate = privateConversationCandidates(rows.rows as Array<Record<string,unknown>>,members.filter((x):x is string=>typeof x==="string"))[0];
      if (!candidate || candidate.sourceId !== messageId) return {status:404,error:"CANON_CANDIDATE_NOT_FOUND"};
      const setup = (state.creatorSetup ?? {}) as Record<string,unknown>;
      const entries = Array.isArray(setup.canonKnowledgeEvents) ? setup.canonKnowledgeEvents : [];
      const dismissed = Array.isArray(setup.dismissedCanonEventIds) ? setup.dismissedCanonEventIds : [];
      const key = `group:${groupId.data}:${messageId}`;
      if (dismissed.includes(key) || entries.some(row=>row && typeof row==="object" && (row as Record<string,unknown>).sourceKey===key))
        return {status:200,duplicate:true};
      const nextSetup = action==="dismiss"
        ? {...setup,dismissedCanonEventIds:[...dismissed.slice(-999),key]}
        : {...setup,canonKnowledgeEvents:[...entries.slice(-199),{
          sourceKey:key,text:text??candidate.text,visibility:"participants",
          witnessIds:candidate.witnessIds,occurredAt:candidate.occurredAt,
        }]};
      await tx.update(echoUniversesTable).set({
        state:{...state,creatorSetup:nextSetup},revision:sql`${echoUniversesTable.revision} + 1`,updatedAt:new Date(),
      }).where(and(eq(echoUniversesTable.ownerId,req.userId!),eq(echoUniversesTable.universeId,universeId)));
      return {status:200,saved:true};
    });
    if ("error" in result) {res.status(result.status).json({error:result.error});return;}
    res.json(result);
  } catch {res.status(503).json({error:"GROUP_CANON_DECISION_UNAVAILABLE"});}
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
  let kindroidDelivery: "not_linked" | "sent" | "failed" | "too_long" = "not_linked";
  if (req.userId! === "user_3LeoBfUicTthDVixNbkPlqXFkdZ") {
    const linked = await db.execute(sql`SELECT kindroid_group_id FROM echo_group_conversations
      WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}`);
    const target = linked.rows[0]?.kindroid_group_id;
    if (typeof target === "string" && target && text.length > 1500) {
      kindroidDelivery = "too_long";
    } else if (typeof target === "string" && target) {
      try {
        const visual: string[] = [];
        for (const attachment of attachments.filter(a => a.type === "image").slice(0, 2)) {
          try { visual.push(await describeGroupAttachment(req.userId!, attachment)); }
          catch (error) { console.warn("[kindroid-group] vision failed", { groupId, messageId, code: error instanceof Error ? error.message : "UNKNOWN" }); visual.push("Image attached in ECHO; visual analysis unavailable."); }
        }
        const context = visual.length ? "\n[Attached image description: " + visual.join("; ").slice(0, 900) + "]" : "";
        const message = text || (visual.length ? "" : "[Attachment shared in ECHO]");
        const available = 1500 - message.length;
        const visualContext = context.length <= available ? context : available > 40 ? context.slice(0, available - 1) + "]" : "";
        await sendKindroidSocialGroupContext(target, message + visualContext);
        kindroidDelivery = "sent";
      } catch {
        kindroidDelivery = "failed";
        console.warn("[kindroid-group] direct delivery failed", { groupId, messageId });
      }
    }
  }
  res.status(201).json({ id: messageId, groupId, senderId: actorId, text, attachments, createdAt: inserted.rows[0].created_at, kindroidDelivery });
  if (kindroidDelivery === "sent") {
    void runGroupAutonomyOnce(req.userId!, universeId, groupId, false, undefined, messageId)
      .then(async result => {
        if ("replyId" in result && result.replyId && result.speakerId) {
          const followUp = await runGroupAutonomyOnce(req.userId!, universeId, groupId, false, undefined, messageId,
            { id: result.replyId, speakerId: result.speakerId });
          if (followUp.status === "skipped") req.log.info({ groupId, messageId, reason: followUp.reason }, "Kindroid group follow-up skipped");
        } else if (result.status === "skipped") {
          req.log.info({ groupId, messageId, reason: result.reason }, "Kindroid group reply skipped");
        }
      })
      .catch(() => req.log.warn({ groupId, messageId }, "Kindroid group reply failed"));
  }
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
// Only the group creator may permanently delete a conversation for every participant.
// Leaving is separate and does not erase shared history.
router.delete("/group-dms/:groupId/messages/:messageId", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success || !id.safeParse(req.params.groupId).success || !id.safeParse(req.params.messageId).success) { res.status(400).json({error:"INVALID_MESSAGE"}); return; }
  const {universeId, actorId} = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({error:"INVALID_IDENTITY"}); return; }
  try {
    const result = await db.execute(sql`DELETE FROM echo_group_messages m WHERE m.owner_id=${req.userId!} AND m.universe_id=${universeId} AND m.group_id=${String(req.params.groupId)} AND m.id=${String(req.params.messageId)} AND m.sender_id=${actorId} AND EXISTS (SELECT 1 FROM echo_group_conversations g WHERE g.owner_id=m.owner_id AND g.universe_id=m.universe_id AND g.id=m.group_id AND g.participant_ids ? ${actorId}) RETURNING m.id`);
    if (!result.rows.length) {res.status(404).json({error:"MESSAGE_NOT_FOUND"});return;}
    res.json({deleted:true});
  } catch {res.status(503).json({error:"MESSAGE_DELETE_FAILED"});}
});
router.delete("/group-dms/:groupId", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_GROUP" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  try {
    const groupId = String(req.params.groupId);
    const result = await db.transaction(async tx => {
      const existing = await tx.execute(sql`SELECT id FROM echo_group_conversations
        WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId}
          AND created_by=${actorId} FOR UPDATE`);
      if (!existing.rows.length) return false;
      await tx.execute(sql`DELETE FROM echo_group_member_preferences
        WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND group_id=${groupId}`);
      await tx.execute(sql`DELETE FROM echo_group_conversations
        WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId}
          AND created_by=${actorId}`);
      return true;
    });
    if (!result) { res.status(403).json({ error: "ONLY_GROUP_CREATOR_CAN_DELETE" }); return; }
    res.json({ deleted: true });
  } catch { res.status(503).json({ error: "GROUP_DELETE_FAILED" }); }
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
    AND (participant_ids ? ${actorId} OR scene_observer_enabled = true) RETURNING avatar`);
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
  const preferredSpeakerId = typeof req.body?.preferredSpeakerId === "string" && id.safeParse(req.body.preferredSpeakerId).success ? req.body.preferredSpeakerId : undefined;
  const allowed = await db.execute(sql`SELECT id FROM echo_group_conversations
    WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND id=${groupId}
      AND scene_observer_enabled=true LIMIT 1`);
  if (!allowed.rows.length) { res.status(403).json({ error: "SCENE_NOT_ENABLED" }); return; }
  try {
    const result = await runGroupAutonomyOnce(req.userId!, universeId, groupId, true, preferredSpeakerId);
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
