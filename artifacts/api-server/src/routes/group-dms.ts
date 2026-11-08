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
const sendBody = scope.extend({ text: z.string().trim().min(1).max(10000) });
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
  id: row.id, name: row.name, avatar: row.avatar, createdBy: row.created_by,
  participantIds: row.participant_ids, createdAt: row.created_at, updatedAt: row.updated_at,
});
router.get("/group-dms", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT id, name, avatar, created_by, participant_ids, created_at, updated_at
    FROM echo_group_conversations WHERE owner_id = ${req.userId!} AND universe_id = ${universeId}
    AND participant_ids ? ${actorId} ORDER BY updated_at DESC LIMIT 100`);
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
    AND participant_ids ? ${actorId} LIMIT 1`);
  if (!group.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  const messages = await db.execute(sql`SELECT id, group_id AS "groupId", sender_id AS "senderId",
    body AS text, attachments, read_by AS "readBy", quote_message_id AS "quoteMessageId",
    created_at AS "createdAt" FROM echo_group_messages
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND group_id = ${groupId}
    ORDER BY created_at DESC LIMIT 100`);
  res.json({ messages: [...messages.rows].reverse() });
});
router.post("/group-dms/:groupId/messages", async (req, res) => {
  const parsed = sendBody.safeParse(req.body);
  if (!parsed.success || !id.safeParse(req.params.groupId).success) { res.status(400).json({ error: "INVALID_MESSAGE" }); return; }
  const { universeId, actorId, text } = parsed.data;
  if (!await getUniverse(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const groupId = String(req.params.groupId);
  const messageId = randomUUID();
  const inserted = await db.execute(sql`INSERT INTO echo_group_messages
    (owner_id, universe_id, id, group_id, sender_id, body, read_by)
    SELECT ${req.userId!}, ${universeId}, ${messageId}, id, ${actorId}, ${text}, ${JSON.stringify([actorId])}::jsonb
    FROM echo_group_conversations
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}
    AND participant_ids ? ${actorId} RETURNING id, created_at`);
  if (!inserted.rows.length) { res.status(404).json({ error: "GROUP_NOT_FOUND" }); return; }
  await db.execute(sql`UPDATE echo_group_conversations SET updated_at = now()
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND id = ${groupId}`);
  res.status(201).json({ id: messageId, groupId, senderId: actorId, text, createdAt: inserted.rows[0].created_at });
});
export default router;
