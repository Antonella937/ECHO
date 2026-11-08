import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { db, echoUniversesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

export const scenesRouter: IRouter = Router();
scenesRouter.use("/scenes", requireAuth);
const id = z.string().min(1).max(120);
const scope = z.object({ universeId: id.default("primary") });
const create = scope.extend({
  title: z.string().trim().min(1).max(160),
  premise: z.string().max(4000).default(""),
  canon: z.enum(["main", "alternate"]),
  participantIds: z.array(id).min(1).max(20),
}).strict();
const event = scope.extend({
  sceneId: id, actorId: id, text: z.string().trim().min(1).max(5000),
  visibility: z.enum(["public", "participants", "private"]).default("participants"),
  audienceIds: z.array(id).max(20).default([]),
}).strict();
async function availableCharacters(ownerId: string, universeId: string): Promise<Set<string> | null> {
  const [universe] = await db.select({ state: echoUniversesTable.state, archivedAt: echoUniversesTable.archivedAt, deletedAt: echoUniversesTable.deletedAt })
    .from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId))).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) return null;
  const state = universe.state as { characters?: Array<{ id: string; archived?: boolean }> } | null;
  return new Set((state?.characters ?? []).filter(c => !c.archived).map(c => c.id));
}
scenesRouter.get("/scenes", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_SCOPE" }); return; }
  const { universeId } = parsed.data;
  try {
    if (!await availableCharacters(req.userId!, universeId)) { res.status(403).json({ error: "UNIVERSE_NOT_ACCESSIBLE" }); return; }
    const rows = await db.execute(sql`SELECT scene_id AS "sceneId", title, premise, canon, participant_ids AS "participantIds", turn_settings AS "turnSettings", status, created_at AS "createdAt"
      FROM echo_scenes WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} ORDER BY updated_at DESC LIMIT 100`);
    res.json({ scenes: rows.rows });
  } catch { res.status(503).json({ error: "SCENES_UNAVAILABLE" }); }
});
scenesRouter.post("/scenes", async (req, res) => {
  const parsed = create.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_SCENE" }); return; }
  const { universeId, title, premise, canon, participantIds } = parsed.data;
  try {
    const characters = await availableCharacters(req.userId!, universeId);
    if (!characters || new Set(participantIds).size !== participantIds.length || participantIds.some(x => !characters.has(x))) {
      res.status(403).json({ error: "INVALID_SCENE_PARTICIPANTS" }); return;
    }
    const sceneId = randomUUID();
    const participants = JSON.stringify(participantIds);
    const turns = JSON.stringify({ mode: "automatic", participantIds, order: participantIds, nextCharacterId: null, cursor: 0 });
    await db.execute(sql`INSERT INTO echo_scenes (owner_id,universe_id,scene_id,title,premise,canon,participant_ids,turn_settings)
      VALUES (${req.userId!},${universeId},${sceneId},${title},${premise},${canon},${participants}::jsonb,${turns}::jsonb)`);
    res.status(201).json({ sceneId, title, premise, canon, participantIds, status: "active" });
  } catch { res.status(503).json({ error: "SCENE_CREATE_FAILED" }); }
});
scenesRouter.get("/scenes/:sceneId/events", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  const sceneId = id.safeParse(req.params.sceneId);
  if (!parsed.success || !sceneId.success) { res.status(400).json({ error: "INVALID_SCENE" }); return; }
  try {
    const rows = await db.execute(sql`SELECT event_id AS "eventId", actor_id AS "actorId", visibility, audience_ids AS "audienceIds", text, created_at AS "createdAt"
      FROM echo_scene_events WHERE owner_id = ${req.userId!} AND universe_id = ${parsed.data.universeId}
      AND scene_id = ${sceneId.data} ORDER BY created_at, event_id LIMIT 500`);
    res.json({ events: rows.rows });
  } catch { res.status(503).json({ error: "SCENE_EVENTS_UNAVAILABLE" }); }
});
scenesRouter.post("/scenes/events", async (req, res) => {
  const parsed = event.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_SCENE_EVENT" }); return; }
  const { universeId, sceneId, actorId, text, visibility, audienceIds } = parsed.data;
  try {
    const rows = await db.execute(sql`SELECT participant_ids, status FROM echo_scenes
      WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND scene_id = ${sceneId} LIMIT 1`);
    const scene = rows.rows[0];
    const participants = Array.isArray(scene?.participant_ids) ? scene.participant_ids : [];
    if (scene?.status !== "active" || !participants.includes(actorId) ||
        audienceIds.some(a => !participants.includes(a))) {
      res.status(403).json({ error: "SCENE_EVENT_NOT_ALLOWED" }); return;
    }
    const eventId = randomUUID();
    const audience = JSON.stringify(audienceIds);
    await db.execute(sql`INSERT INTO echo_scene_events (owner_id,universe_id,scene_id,event_id,actor_id,visibility,audience_ids,text)
      VALUES (${req.userId!},${universeId},${sceneId},${eventId},${actorId},${visibility},${audience}::jsonb,${text})`);
    res.status(201).json({ eventId });
  } catch { res.status(503).json({ error: "SCENE_EVENT_FAILED" }); }
});
