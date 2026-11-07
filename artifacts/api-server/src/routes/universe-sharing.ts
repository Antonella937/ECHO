import { db, echoUniversesTable } from "@workspace/db";
import { and, eq, isNull } from "drizzle-orm";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { randomBytes, createHash } from "node:crypto";
import { sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { createAdditionalUniverse, writeUniverse, StructuralLimitError } from "../lib/universeRepository";
import { SaveUniverseBody } from "@workspace/api-zod";

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
    const inherited = await db.execute(sql`SELECT recipient_character_id FROM echo_import_provenance
      WHERE recipient_owner_id=${req.userId!} AND recipient_universe_id=${params.data.universeId}`);
    const importedIds = new Set(inherited.rows.map(row => String(row.recipient_character_id)));
    if (importedIds.has("") || (body.data.kind === "character" && importedIds.has(body.data.characterId!))) {
      res.status(403).json({error:"ORIGINAL_CREATOR_ONLY"}); return;
    }
    const characters = Array.isArray(universe.state.characters) ? universe.state.characters as Array<{id?:string;archived?:boolean}> : [];
    if (body.data.kind === "character" && !characters.some(x => x.id === body.data.characterId && !x.archived)) {
      res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return;
    }
    if (body.data.kind === "character") {
      const privateRows = await db.execute(sql`SELECT 1 FROM echo_character_privacy
        WHERE owner_id=${req.userId!} AND universe_id=${params.data.universeId}
        AND character_id=${body.data.characterId!} AND visibility='private' LIMIT 1`);
      if (privateRows.rows.length) { res.status(403).json({ error: "CHARACTER_PRIVATE" }); return; }
    }
    if (body.data.kind === "universe" && importedIds.size > 0) {
      // Mixed worlds must never redistribute a recipient's imported characters.
      // Until granular export selection is supported, fail closed.
      res.status(403).json({ error: "WORLD_CONTAINS_IMPORTED_CHARACTERS" }); return;
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
    const invitation = await db.execute(sql`SELECT 1 FROM echo_collaboration_invites
      WHERE token_hash=${hash} AND revoked_at IS NULL LIMIT 1`);
    const isCollaborationInvite = invitation.rows.length > 0;
    const state = row.state;
    const characters = Array.isArray(state.characters) ? state.characters as Array<Record<string, unknown>> : [];
    const privateRows = await db.execute(sql`SELECT character_id FROM echo_character_privacy
      WHERE owner_id=${row.owner_id} AND universe_id=${row.universe_id} AND visibility='private'`);
    const hidden = new Set(privateRows.rows.map(x => String(x.character_id)));
    const importedRows = await db.execute(sql`SELECT recipient_character_id FROM echo_import_provenance
      WHERE recipient_owner_id=${row.owner_id} AND recipient_universe_id=${row.universe_id}`);
    const inherited = new Set(importedRows.rows.map(x => String(x.recipient_character_id)));
    const visible = characters.filter(ch => !ch.archived && !hidden.has(String(ch.id)) && !inherited.has(String(ch.id)) && !inherited.has("") && (row.kind === "universe" || ch.id === row.character_id))
      .map(ch => ({ id: ch.id, name: ch.name, handle: ch.handle, bio: ch.bio, occupation: ch.occupation }));
    if (!visible.length) { res.status(404).json({ error: "SHARE_NOT_FOUND" }); return; }
    const setup = state.creatorSetup as Record<string, unknown> | undefined;
    res.json({ kind: row.kind, universeName: setup?.universeName ?? "Universo ECHO",
      description: setup?.universeDescription ?? "", characters: visible, importAvailable: !isCollaborationInvite, collaborationInvite: isCollaborationInvite });
  });


  // Copy only public character identity, never conversation history, memory, credentials or media.
  router.post("/universe/shared/:token/import", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { res.status(404).json({ error: "SHARE_NOT_FOUND" }); return; }
    const hash = createHash("sha256").update(token).digest("hex");
    const rows = await db.execute(sql`SELECT l.owner_id, l.universe_id, l.kind, l.character_id, u.state
      FROM echo_share_links l JOIN echo_universes u ON u.owner_id = l.owner_id AND u.universe_id = l.universe_id
      WHERE l.token_hash = ${hash} AND l.revoked_at IS NULL AND u.sharing_enabled = true
      AND u.archived_at IS NULL AND u.deleted_at IS NULL LIMIT 1`);
    const source = rows.rows[0] as { owner_id:string; universe_id:string; kind:string; character_id:string|null; state:Record<string,unknown> } | undefined;
    if (!source || source.owner_id === req.userId) { res.status(403).json({ error: "IMPORT_NOT_ALLOWED" }); return; }
    const invitation = await db.execute(sql`SELECT 1 FROM echo_collaboration_invites
      WHERE token_hash=${hash} LIMIT 1`);
    if (invitation.rows.length) {res.status(403).json({error:"INVITATION_NOT_IMPORTABLE"});return;}
    const privacyRows = await db.execute(sql`SELECT character_id FROM echo_character_privacy
      WHERE owner_id=${source.owner_id} AND universe_id=${source.universe_id} AND visibility='private'`);
    const hidden = new Set(privacyRows.rows.map(x => String(x.character_id)));
    const originRows = await db.execute(sql`SELECT recipient_character_id FROM echo_import_provenance
      WHERE recipient_owner_id=${source.owner_id} AND recipient_universe_id=${source.universe_id}`);
    const inherited = new Set(originRows.rows.map(x => String(x.recipient_character_id)));
    if (inherited.has('')) {res.status(403).json({error:"ORIGINAL_CREATOR_ONLY"});return;}
    const state = source.state;
    const originals = Array.isArray(state.characters) ? state.characters as Array<Record<string,unknown>> : [];
    const chosen = originals.filter(ch => !ch.archived && !hidden.has(String(ch.id)) && !inherited.has(String(ch.id)) && ch.id !== "nela" &&
      (source.kind === "universe" || ch.id === source.character_id));
    if (!chosen.length) { res.status(422).json({ error: "NO_IMPORTABLE_CHARACTERS" }); return; }
    // Reuse the recipient's own identity as the primary account; never copy the sender's owner identity.
    const [recipient] = await db.select().from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, "primary"),
      isNull(echoUniversesTable.archivedAt), isNull(echoUniversesTable.deletedAt))).limit(1);
    if (!recipient) { res.status(409).json({ error: "RECIPIENT_ONBOARDING_REQUIRED" }); return; }
    const own = SaveUniverseBody.shape.state.safeParse(recipient.state);
    if (!own.success) { res.status(409).json({ error: "RECIPIENT_STATE_INVALID" }); return; }
    const ids = new Set(own.data.characters.map(ch => ch.id));
    const handles = new Set(own.data.characters.map(ch => ch.handle.toLowerCase()));
    const imported = chosen.map(original => {
      const id = crypto.randomUUID();
      let handle = String(original.handle ?? "imported").replace(/[^a-zA-Z0-9_.]/g, "").slice(0,20) || "imported";
      const base = handle;
      let n = 1;
      while (handles.has(handle.toLowerCase())) handle = (base.slice(0, 14) + "_" + n++).slice(0, 24);
      handles.add(handle.toLowerCase()); ids.add(id);
      return {
        id, handle, name: String(original.name ?? "Personaje").slice(0, 80),
        occupation: String(original.occupation ?? "").slice(0, 160),
        bio: String(original.bio ?? "").slice(0, 500),
        location: "", avatar: "asset:account-default",
        providerRef: { provider: "mock", externalId: null, status: "not_connected", lastSyncAt: null },
        identity: { provider: "mock", referenceImages: [], seed: 0, appearance: "", styleNotes: "", updatedAt: new Date().toISOString() },
        accountType: "personal", verified: false, archived: false,
      };
    });
    try {
      if (source.kind === "character") {
        const next = { ...own.data, characters: [...own.data.characters, ...imported],
          follows: { ...own.data.follows, ...Object.fromEntries(imported.map(ch => [ch.id, []])) } };
        const parsed = SaveUniverseBody.shape.state.safeParse(next);
        if (!parsed.success) { res.status(422).json({ error: "IMPORT_VALIDATION_FAILED" }); return; }
        const saved = await writeUniverse(req.userId!, parsed.data as Record<string,unknown>, recipient.revision, "primary", async tx => {
          for (let i=0;i<imported.length;i++) {
            await tx.execute(sql`INSERT INTO echo_import_provenance(recipient_owner_id,recipient_universe_id,recipient_character_id,
              original_owner_id,original_universe_id,original_character_id)
              VALUES(${req.userId!},'primary',${imported[i].id},${source.owner_id},${source.universe_id},${String(chosen[i].id)})`);
          }
        });
        if (!saved) { res.status(409).json({ error: "REVISION_CONFLICT" }); return; }
        res.status(201).json({ kind: "character", universeId: "primary", importedCount: imported.length }); return;
      }
      const name = String((state.creatorSetup as Record<string,unknown> | undefined)?.universeName ?? "Universo importado").slice(0,60);
      const next = { ...own.data, characters: [own.data.characters.find(ch => ch.id === "nela")!, ...imported],
        currentCharacterId: "nela", follows: { nela: [], ...Object.fromEntries(imported.map(ch => [ch.id, []])) },
        posts: [], comments: [], stories: [], messages: [], notifications: [], highlights: [] };
      const parsed = SaveUniverseBody.shape.state.safeParse(next);
      if (!parsed.success) { res.status(422).json({ error: "IMPORT_VALIDATION_FAILED" }); return; }
      const created = await createAdditionalUniverse(req.userId!, name, parsed.data as Record<string,unknown>, async (tx, newUniverseId) => {
        await tx.execute(sql`INSERT INTO echo_import_provenance(recipient_owner_id,recipient_universe_id,recipient_character_id,
          original_owner_id,original_universe_id)
          VALUES(${req.userId!},${newUniverseId},'',${source.owner_id},${source.universe_id})`);
      });
      res.status(201).json({ kind: "universe", universeId: created.universeId, importedCount: imported.length });
    } catch (error) {
      if (error instanceof StructuralLimitError) { res.status(409).json({ error: error.code }); return; }
      throw error;
    }
  });


  // Collaboration is a distinct opt-in: invitation links never silently grant editing rights.
  router.post("/universe/shared/:token/join", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const token = req.params.token;
    if (!/^[A-Za-z0-9_-]{43}$/.test(token)) { res.status(404).json({ error: "SHARE_NOT_FOUND" }); return; }
    const hash = createHash("sha256").update(token).digest("hex");
    const rows = await db.execute(sql`SELECT l.owner_id, l.universe_id FROM echo_share_links l
      JOIN echo_universes u ON u.owner_id=l.owner_id AND u.universe_id=l.universe_id
      WHERE l.token_hash=${hash} AND l.kind='universe' AND l.revoked_at IS NULL
      AND u.sharing_enabled=true AND u.archived_at IS NULL AND u.deleted_at IS NULL LIMIT 1`);
    const row = rows.rows[0] as {owner_id:string;universe_id:string}|undefined;
    if (!row || row.owner_id === req.userId) { res.status(403).json({error:"JOIN_NOT_ALLOWED"}); return; }
    // Require a separately issued collaborator invitation, not a general share URL.
    const invites = await db.execute(sql`SELECT 1 FROM echo_collaboration_invites WHERE token_hash=${hash}
      AND owner_id=${row.owner_id} AND universe_id=${row.universe_id} AND revoked_at IS NULL LIMIT 1`);
    if (!invites.rows.length) { res.status(403).json({error:"COLLABORATION_INVITE_REQUIRED"}); return; }
    await db.execute(sql`INSERT INTO echo_universe_collaborators(owner_id,universe_id,collaborator_id)
      VALUES (${row.owner_id},${row.universe_id},${req.userId!}) ON CONFLICT DO NOTHING`);
    res.status(201).json({ownerId:row.owner_id,universeId:row.universe_id,role:"editor"});
  });

  router.post("/universe/:universeId/collaboration-invites", async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const params = universeParamsSchema.safeParse(req.params);
    if (!params.success) { res.status(400).json({error:"INVALID_UNIVERSE_ID"}); return; }
    const inherited = await db.execute(sql`SELECT 1 FROM echo_import_provenance WHERE recipient_owner_id=${req.userId!}
      AND recipient_universe_id=${params.data.universeId} AND recipient_character_id='' LIMIT 1`);
    if (inherited.rows.length) {res.status(403).json({error:"ORIGINAL_CREATOR_ONLY"});return;}
    const [row] = await db.select().from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId,req.userId!),eq(echoUniversesTable.universeId,params.data.universeId),
      isNull(echoUniversesTable.archivedAt),isNull(echoUniversesTable.deletedAt))).limit(1);
    if (!row || !row.sharingEnabled) { res.status(403).json({error:"SHARING_DISABLED"}); return; }
    const token = randomBytes(32).toString("base64url");
    const hash = createHash("sha256").update(token).digest("hex");
    await db.execute(sql`INSERT INTO echo_share_links(token_hash,owner_id,universe_id,kind)
      VALUES (${hash},${req.userId!},${params.data.universeId},'universe')`);
    await db.execute(sql`INSERT INTO echo_collaboration_invites(token_hash,owner_id,universe_id)
      VALUES (${hash},${req.userId!},${params.data.universeId})`);
    res.status(201).json({token});
  });

  router.get("/universe/collaborations/mine", async (req,res):Promise<void> => {
    res.setHeader("Cache-Control","private, no-store");
    const rows = await db.execute(sql`SELECT c.owner_id, c.universe_id, c.role,
      u.state->'creatorSetup'->>'universeName' AS name
      FROM echo_universe_collaborators c JOIN echo_universes u
      ON u.owner_id=c.owner_id AND u.universe_id=c.universe_id
      WHERE c.collaborator_id=${req.userId!} AND u.sharing_enabled=true
      AND u.archived_at IS NULL AND u.deleted_at IS NULL`);
    res.json(rows.rows);
  });

  // Shared editor deliberately exposes ONLY public world metadata.
  // The owner's full social state, private conversations and memories never cross this boundary.
  router.get("/universe/collaborations/:ownerId/:universeId", async (req,res):Promise<void> => {
    res.setHeader("Cache-Control","private, no-store");
    const {ownerId,universeId}=req.params;
    const rows=await db.execute(sql`SELECT u.state->'creatorSetup'->>'universeName' AS name,
      u.state->'creatorSetup'->>'universeDescription' AS description, u.revision
      FROM echo_universe_collaborators c JOIN echo_universes u
      ON u.owner_id=c.owner_id AND u.universe_id=c.universe_id
      WHERE c.owner_id=${ownerId} AND c.universe_id=${universeId}
      AND c.collaborator_id=${req.userId!} AND u.sharing_enabled=true
      AND u.archived_at IS NULL AND u.deleted_at IS NULL LIMIT 1`);
    if (!rows.rows.length) {res.status(404).json({error:"COLLABORATION_NOT_FOUND"});return;}
    res.json(rows.rows[0]);
  });

  router.patch("/universe/collaborations/:ownerId/:universeId", async (req,res):Promise<void> => {
    res.setHeader("Cache-Control","private, no-store");
    const parsed=z.object({name:z.string().trim().min(1).max(60),description:z.string().max(500),
      expectedRevision:z.number().int().positive()}).strict().safeParse(req.body);
    if (!parsed.success) {res.status(400).json({error:"INVALID_COLLABORATION_EDIT"});return;}
    const {ownerId,universeId}=req.params;
    const rows=await db.execute(sql`UPDATE echo_universes u SET
      state=jsonb_set(jsonb_set(u.state,'{creatorSetup,universeName}',to_jsonb(${parsed.data.name}::text),true),
      '{creatorSetup,universeDescription}',to_jsonb(${parsed.data.description}::text),true),
      revision=u.revision+1, updated_at=now()
      WHERE u.owner_id=${ownerId} AND u.universe_id=${universeId} AND u.revision=${parsed.data.expectedRevision}
      AND u.sharing_enabled=true AND u.archived_at IS NULL AND u.deleted_at IS NULL
      AND EXISTS(SELECT 1 FROM echo_universe_collaborators c WHERE c.owner_id=u.owner_id
        AND c.universe_id=u.universe_id AND c.collaborator_id=${req.userId!} AND c.role='editor')
      RETURNING u.revision`);
    if (!rows.rows.length) {res.status(409).json({error:"COLLABORATION_CONFLICT_OR_REVOKED"});return;}
    res.json(rows.rows[0]);
  });

  router.get("/universe/:universeId/collaborators", async (req,res):Promise<void> => {
    res.setHeader("Cache-Control","private, no-store");
    const params=universeParamsSchema.safeParse(req.params);
    if(!params.success){res.status(400).json({error:"INVALID_UNIVERSE_ID"});return;}
    const rows=await db.execute(sql`SELECT c.collaborator_id, c.role, c.joined_at FROM echo_universe_collaborators c
      JOIN echo_universes u ON u.owner_id=c.owner_id AND u.universe_id=c.universe_id
      WHERE c.owner_id=${req.userId!} AND c.universe_id=${params.data.universeId}
      AND u.archived_at IS NULL AND u.deleted_at IS NULL`);
    res.json(rows.rows);
  });

  router.delete("/universe/:universeId/collaborators/:collaboratorId", async (req,res):Promise<void> => {
    res.setHeader("Cache-Control","private, no-store");
    const params=universeParamsSchema.safeParse(req.params);
    if (!params.success) {res.status(400).json({error:"INVALID_UNIVERSE_ID"});return;}
    await db.execute(sql`DELETE FROM echo_universe_collaborators WHERE owner_id=${req.userId!}
      AND universe_id=${params.data.universeId} AND collaborator_id=${req.params.collaboratorId}`);
    res.status(204).end();
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
