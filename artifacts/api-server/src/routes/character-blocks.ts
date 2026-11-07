import { Router, type IRouter, type Request, type Response } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, echoCharacterBlocksTable, echoUniversesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const schema = z.object({
  universeId: z.string().min(1).max(120),
  blockerId: z.string().min(1).max(120),
  blockedId: z.string().min(1).max(120),
}).strict();

export function createCharacterBlocksRouter(): IRouter {
  const router: IRouter = Router();
  router.use("/character-blocks", requireAuth);
  router.get("/character-blocks", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const universeId = z.string().min(1).max(120).safeParse(req.query.universeId);
    if (!universeId.success) { res.status(400).json({ error: "INVALID_UNIVERSE" }); return; }
    try {
      const rows = await db.select({
        blockerId: echoCharacterBlocksTable.blockerCharacterId,
        blockedId: echoCharacterBlocksTable.blockedCharacterId,
      }).from(echoCharacterBlocksTable).where(and(
        eq(echoCharacterBlocksTable.blockerOwnerId, req.userId!),
        eq(echoCharacterBlocksTable.blockerUniverseId, universeId.data),
      ));
      res.json({ blocks: rows });
    } catch { res.status(503).json({ error: "BLOCKS_UNAVAILABLE" }); }
  });
  const change = async (req: Request, res: Response, remove: boolean) => {
    const parsed = schema.safeParse(req.body);
    if (!parsed.success || parsed.data.blockerId === parsed.data.blockedId) {
      res.status(400).json({ error: "INVALID_CHARACTER_BLOCK" }); return;
    }
    const { universeId, blockerId, blockedId } = parsed.data;
    try {
      const [universe] = await db.select({ state: echoUniversesTable.state })
        .from(echoUniversesTable).where(and(
          eq(echoUniversesTable.ownerId, req.userId!),
          eq(echoUniversesTable.universeId, universeId),
        )).limit(1);
      const characters = (universe?.state as { characters?: Array<{ id: string; archived?: boolean }> } | undefined)?.characters ?? [];
      if (![blockerId, blockedId].every(id => characters.some(c => c.id === id && !c.archived))) {
        res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return;
      }
      const where = and(
        eq(echoCharacterBlocksTable.blockerOwnerId, req.userId!),
        eq(echoCharacterBlocksTable.blockerUniverseId, universeId),
        eq(echoCharacterBlocksTable.blockerCharacterId, blockerId),
        eq(echoCharacterBlocksTable.blockedOwnerId, req.userId!),
        eq(echoCharacterBlocksTable.blockedUniverseId, universeId),
        eq(echoCharacterBlocksTable.blockedCharacterId, blockedId),
      );
      if (remove) await db.delete(echoCharacterBlocksTable).where(where);
      else await db.insert(echoCharacterBlocksTable).values({
        blockerOwnerId: req.userId!, blockerUniverseId: universeId, blockerCharacterId: blockerId,
        blockedOwnerId: req.userId!, blockedUniverseId: universeId, blockedCharacterId: blockedId,
      }).onConflictDoNothing();
      res.json({ ok: true });
    } catch { res.status(503).json({ error: "BLOCKS_UNAVAILABLE" }); }
  };
  router.post("/character-blocks", (req, res) => { void change(req, res, false); });
  router.delete("/character-blocks", (req, res) => { void change(req, res, true); });
  return router;
}
export const characterBlocksRouter = createCharacterBlocksRouter();
