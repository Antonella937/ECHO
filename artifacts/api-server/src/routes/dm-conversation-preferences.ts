import { Router, type IRouter } from "express";
import { and, eq, sql } from "drizzle-orm";
import { z } from "zod";
import { db, echoUniversesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const identifier = z.string().min(1).max(120);
const preferences = z.object({
  style: z.enum(["natural", "narrative", "mixed"]),
  responseTiming: z.enum(["realistic", "instant"]),
  responseLength: z.enum(["short", "balanced", "detailed"]),
  autonomousInitiative: z.boolean(),
}).strict();
const scope = z.object({ universeId: identifier.default("primary"), characterId: identifier });
const defaults = { style: "natural", responseTiming: "realistic", responseLength: "balanced", autonomousInitiative: true };
export const dmConversationPreferencesRouter: IRouter = Router();
dmConversationPreferencesRouter.use("/dm/conversation-preferences", requireAuth);

async function ownsCharacter(ownerId: string, universeId: string, characterId: string): Promise<boolean> {
  const [universe] = await db.select({ state: echoUniversesTable.state, archivedAt: echoUniversesTable.archivedAt, deletedAt: echoUniversesTable.deletedAt })
    .from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId))).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) return false;
  const state = universe.state as { characters?: Array<{ id: string; archived?: boolean }> } | null;
  return !!state?.characters?.some(c => c.id === characterId && !c.archived);
}

dmConversationPreferencesRouter.get("/dm/conversation-preferences", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const parsed = scope.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_QUERY" }); return; }
  const { universeId, characterId } = parsed.data;
  try {
    if (!await ownsCharacter(req.userId!, universeId, characterId)) { res.status(403).json({ error: "CHARACTER_NOT_ACCESSIBLE" }); return; }
    const result = await db.execute(sql`SELECT preferences FROM echo_dm_conversation_preferences WHERE owner_id = ${req.userId!} AND universe_id = ${universeId} AND character_id = ${characterId} LIMIT 1`);
    const saved = result.rows[0]?.preferences;
    const valid = preferences.safeParse(saved);
    res.json({ preferences: valid.success ? valid.data : defaults });
  } catch (error) {
    req.log.error({ error }, "DM preferences read failed");
    res.status(503).json({ error: "DM_PREFERENCES_UNAVAILABLE" });
  }
});

dmConversationPreferencesRouter.put("/dm/conversation-preferences", async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const parsed = scope.extend({ preferences }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_DM_PREFERENCES" }); return; }
  const { universeId, characterId } = parsed.data;
  try {
    if (!await ownsCharacter(req.userId!, universeId, characterId)) { res.status(403).json({ error: "CHARACTER_NOT_ACCESSIBLE" }); return; }
    const payload = JSON.stringify(parsed.data.preferences);
    await db.execute(sql`INSERT INTO echo_dm_conversation_preferences (owner_id, universe_id, character_id, preferences)
      VALUES (${req.userId!}, ${universeId}, ${characterId}, ${payload}::jsonb)
      ON CONFLICT (owner_id, universe_id, character_id) DO UPDATE SET preferences = EXCLUDED.preferences, updated_at = now()`);
    res.json({ preferences: parsed.data.preferences });
  } catch (error) {
    req.log.error({ error }, "DM preferences write failed");
    res.status(503).json({ error: "DM_PREFERENCES_UNAVAILABLE" });
  }
});
