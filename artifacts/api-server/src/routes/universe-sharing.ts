import { db, echoUniversesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
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


  // A link is a bearer capability, but all requests still require a signed-in beta user.
  // Store only SHA-256 hashes, never raw link secrets.
  router.post("/universe/:universeId/share-links", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const params = universeParamsSchema.safeParse(req.params);
    const body = z.object({ kind: z.enum(["universe", "character"]), characterId: z.string().max(120).optional() }).strict().safeParse(req.body);
    if (!params.success || !body.success || (body.data.kind === "character" && !body.data.characterId)) {
      res.status(400).json({ error: "INVALID_SHARE_REQUEST" }); return;
    }
    const [universe] = await db.select().from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, params.data.universeId),
      isNull(echoUniversesTable.archivedAt), isNull(echoUniversesTable.deletedAt),
    )).limit(1);
    if (!universe || !universe.sharingEnabled) { res.status(403).json({ error: "SHARING_DISABLED" }); return; }
    const characters = Array.isArray(universe.state.characters) ? universe.state.characters as Array<{id?:string;archived?:boolean}> : [];
    if (body.data.kind === "character" && !characters.some(x => x.id === body.data.characterId && !x.archived)) {
      res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return;
    }
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    await db.execute(sql`INSERT INTO echo_share_links (token_hash, owner_id, universe_id, kind, character_id)
      VALUES (${hash}, ${req.userId!}, ${params.data.universeId}, ${body.data.kind}, ${body.data.characterId ?? null})`);
    res.status(201).json({ token });
  });

  router.get("/universe/shared/:token", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { res.status(404).json({ error: "SHARE_NOT_FOUND" }); return; }
    const hash = createHash("sha256").update(token).digest("hex");
    const rows = await db.execute(sql`SELECT l.owner_id, l.universe_id, l.kind, l.character_id,
      u.state FROM echo_share_links l JOIN echo_universes u ON u.owner_id = l.owner_id AND u.universe_id = l.universe_id
      WHERE l.token_hash = ${hash} AND l.revoked_at IS NULL AND u.sharing_enabled = true
      AND u.archived_at IS NULL AND u.deleted_at IS NULL LIMIT 1`);
    const row = rows.rows[0] as { owner_id: string; universe_id: string; kind: string; character_id: string | null; state: Record<string, unknown> } | undefined;
    if (!row) { res.status(404).json({ error: "SHARE_NOT_FOUND" }); return; }
    const state = row.state;
    const characters = Array.isArray(state.characters) ? state.characters as Array<Record<string, unknown>> : [];
    const visible = characters.filter(ch => !ch.archived && (row.kind === "universe" || ch.id === row.character_id))
      .map(ch => ({ id: ch.id, name: ch.name, handle: ch.handle, bio: ch.bio, occupation: ch.occupation }));
    if (!visible.length) { res.status(404).json({ error: "SHARE_NOT_FOUND" }); return; }
    const setup = state.creatorSetup as Record<string, unknown> | undefined;
    res.json({ kind: row.kind, universeName: setup?.universeName ?? "Universo ECHO",
      description: setup?.universeDescription ?? "", characters: visible, importAvailable: false });
  });

  router.delete("/universe/:universeId/share-links/:token", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const params = universeParamsSchema.safeParse(req.params);
    const token = req.params.token;
    if (!params.success || !/^[A-Za-z0-9_-]{43}$/.test(token)) { res.status(400).json({ error: "INVALID_SHARE_LINK" }); return; }
    const hash = createHash("sha256").update(token).digest("hex");
    await db.execute(sql`UPDATE echo_share_links SET revoked_at = now() WHERE token_hash = ${hash}
      AND owner_id = ${req.userId!} AND universe_id = ${params.data.universeId}`);
    res.status(204).end();
  });
  return router;
}

export default createUniverseSharingRouter();
