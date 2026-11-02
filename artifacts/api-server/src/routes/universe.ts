import {
  GetUniverseResponse,
  SaveUniverseBody,
  SaveUniverseResponse,
} from "@workspace/api-zod";
import { db, echoUniversesTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";

const router: IRouter = Router();

router.use("/universe", requireAuth);

router.get("/universe", async (req, res): Promise<void> => {
  const [universe] = await db
    .select({ state: echoUniversesTable.state })
    .from(echoUniversesTable)
    .where(eq(echoUniversesTable.ownerId, req.userId!))
    .limit(1);

  res.json(GetUniverseResponse.parse({ state: universe?.state ?? null }));
});

router.put("/universe", async (req, res): Promise<void> => {
  const parsed = SaveUniverseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid universe state" });
    return;
  }

  const { state } = parsed.data;
  const characterIds = new Set(state.characters.map((character) => character.id));
  if (!characterIds.has("nela") || !characterIds.has(state.currentCharacterId)) {
    res.status(400).json({ error: "Nela and the active character are required" });
    return;
  }

  const [saved] = await db
    .insert(echoUniversesTable)
    .values({ ownerId: req.userId!, state })
    .onConflictDoUpdate({
      target: echoUniversesTable.ownerId,
      set: { state, updatedAt: new Date() },
    })
    .returning({ state: echoUniversesTable.state });

  res.json(SaveUniverseResponse.parse({ state: saved.state }));
});

export default router;
