import { db, echoUniversesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";

const universeParamsSchema = z.object({
  universeId: z.string().trim().min(1).max(120),
}).strict();

const updateSharingSchema = z.object({
  sharingEnabled: z.boolean(),
}).strict();

type UniverseSharingRouterOptions = {
  authenticate?: RequestHandler;
};

/**
 * Owner-only storage for the universe-level sharing preference.
 * This preference is deliberately not enforced by social read routes here.
 */
export function createUniverseSharingRouter(
  options: UniverseSharingRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  router.use("/universe", options.authenticate ?? requireAuth);

  router.get("/universe/:universeId/sharing", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const params = universeParamsSchema.safeParse(req.params);
    if (!params.success) {
      res.status(400).json({ error: "INVALID_UNIVERSE_ID" });
      return;
    }

    const [universe] = await db.select({
      sharingEnabled: echoUniversesTable.sharingEnabled,
    }).from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId, req.userId!),
      eq(echoUniversesTable.universeId, params.data.universeId),
      isNull(echoUniversesTable.archivedAt), isNull(echoUniversesTable.deletedAt),
    )).limit(1);
    if (!universe) {
      res.status(404).json({ error: "UNIVERSE_NOT_FOUND" });
      return;
    }

    res.json({ universeId: params.data.universeId, sharingEnabled: universe.sharingEnabled });
  });

  router.put("/universe/:universeId/sharing", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const params = universeParamsSchema.safeParse(req.params);
    const body = updateSharingSchema.safeParse(req.body);
    if (!params.success) {
      res.status(400).json({ error: "INVALID_UNIVERSE_ID" });
      return;
    }
    if (!body.success) {
      res.status(400).json({ error: "INVALID_SHARING_SETTING" });
      return;
    }

    const [universe] = await db.update(echoUniversesTable)
      .set({ sharingEnabled: body.data.sharingEnabled })
      .where(and(
        eq(echoUniversesTable.ownerId, req.userId!),
        eq(echoUniversesTable.universeId, params.data.universeId),
        isNull(echoUniversesTable.archivedAt), isNull(echoUniversesTable.deletedAt),
      ))
      .returning({ sharingEnabled: echoUniversesTable.sharingEnabled });
    if (!universe) {
      res.status(404).json({ error: "UNIVERSE_NOT_FOUND" });
      return;
    }

    res.json({ universeId: params.data.universeId, sharingEnabled: universe.sharingEnabled });
  });

  return router;
}

export default createUniverseSharingRouter();
