import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, echoUniversesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();
router.use("/dm-requests", requireAuth);
const identifier = z.string().min(1).max(120);
const scope = z.object({ universeId: identifier.default("primary"), actorId: identifier });
const decision = scope.extend({ senderId: identifier, status: z.enum(["accepted", "rejected", "blocked"]) });
async function authorized(ownerId: string, universeId: string, actorId: string) {
  const [universe] = await db.select({ state: echoUniversesTable.state, archivedAt: echoUniversesTable.archivedAt, deletedAt: echoUniversesTable.deletedAt })
    .from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId))).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) return false;
  const state = universe.state as { characters?: Array<{ id: string; archived?: boolean }> } | null;
  return !!state?.characters?.some(c => c.id === actorId && !c.archived);
}
router.get("/dm-requests", async (req, res) => {
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, actorId } = parsed.data;
  if (!await authorized(req.userId!, universeId, actorId)) { res.status(403).json({ error: "INVALID_IDENTITY" }); return; }
  const result = await db.execute(sql`SELECT sender_id AS "senderId", status FROM echo_dm_request_decisions
    WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND actor_id = ${actorId}`);
  res.json({ decisions: result.rows });
});
router.put("/dm-requests", async (req, res) => {
  const parsed = decision.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_DECISION" }); return; }
  const { universeId, actorId, senderId, status } = parsed.data;
  if (!await authorized(req.userId!, universeId, actorId) || !await authorized(req.userId!, universeId, senderId) || actorId === senderId) {
    res.status(403).json({ error: "INVALID_IDENTITY" }); return;
  }
  const result = await db.execute(sql`INSERT INTO echo_dm_request_decisions
    (owner_id, universe_id, actor_id, sender_id, status)
    VALUES (${req.userId!}, ${universeId}, ${actorId}, ${senderId}, ${status})
    ON CONFLICT (owner_id, universe_id, actor_id, sender_id)
    DO UPDATE SET status = EXCLUDED.status, updated_at = now()
    RETURNING sender_id AS "senderId", status`);
  res.json({ decision: result.rows[0] });
});
export default router;
