import {
  GetUniverseResponse,
  SaveUniverseBody,
  SaveUniverseResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse, writeUniverse, StructuralLimitError } from "../lib/universeRepository";
import { db, echoMediaTable, echoUniversesTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { universeAccountError } from "../lib/universeValidation";
import { recordIncomingConversationEvents } from "../ai-engine/incoming-memory";

const router: IRouter = Router();

router.use("/universe", requireAuth);

router.get("/universe", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const [meta] = await db.select().from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId)));
  if (meta?.archivedAt || meta?.deletedAt) {
    const available = await db.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, req.userId!));
    res.status(409).json({ error: "UNIVERSE_UNAVAILABLE", ownerId: req.userId!, fallbackUniverseId: available.find(row => !row.archivedAt && !row.deletedAt)?.universeId ?? null }); return;
  }
  res.json(GetUniverseResponse.parse(await readUniverse(req.userId!, universeId)));
});

router.put("/universe", async (req, res): Promise<void> => {
  const parsed = SaveUniverseBody.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "Invalid universe state" });
    return;
  }

  const { state, expectedRevision } = parsed.data;
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const accountError = universeAccountError(state);
  if (accountError) { res.status(400).json({ error: accountError }); return; }
  const characterIds = new Set(state.characters.map((character) => character.id));
  if (!characterIds.has("nela") || !characterIds.has(state.currentCharacterId)) {
    res.status(400).json({ error: "Nela and the active character are required" });
    return;
  }

  // Never accept transient URLs or references to someone else's uploads.
  const refs = [...state.characters.flatMap(c => [c.avatar, ...c.identity.referenceImages]),
    ...state.posts.flatMap(p => [p.image, ...(p.media ?? []).map(item => item.url)]), ...state.stories.map(s => s.image),
    ...state.messages.flatMap(m => (m.attachments ?? []).map(item => item.url))];
  if (refs.some(ref => !ref.startsWith("asset:") && !/^\/objects\/uploads\/[a-f0-9-]+$/i.test(ref))) {
    res.status(400).json({ error: "All images must be stored privately before saving" });
    return;
  }
  const objects = [...new Set(refs.filter(ref => ref.startsWith("/objects/")))];
  if (objects.length) {
    const owned = await db.select({ path: echoMediaTable.objectPath }).from(echoMediaTable)
      .where(and(eq(echoMediaTable.ownerId, req.userId!), inArray(echoMediaTable.objectPath, objects)));
    if (owned.length !== objects.length) {
      res.status(400).json({ error: "An image is unavailable to this owner" });
      return;
    }
  }
  // Use the same owner/universe and expected revision for memory extraction.
  // A concurrent write still fails closed in writeUniverse.
  const previous = await readUniverse(req.userId!, universeId);
  const previousState = SaveUniverseBody.shape.state.safeParse(previous.state);
  const enrichedState = previous.revision === expectedRevision && previousState.success
    ? recordIncomingConversationEvents(previousState.data, state) : state;
  let saved;
  try { saved = await writeUniverse(req.userId!, enrichedState, expectedRevision, universeId); }
  catch (error) {
    if (error instanceof Error && error.message === "UNIVERSE_UNAVAILABLE") {
      res.status(409).json({ error: error.message }); return;
    }
    if (error instanceof StructuralLimitError) {
      res.status(409).json({ error: error.code });
      return;
    }
    throw error;
  }
  if (!saved) {
    res.status(409).json({ error: "El universo cambió en otro dispositivo. Tus cambios siguen conservados." });
    return;
  }

  res.json(SaveUniverseResponse.parse(saved));
});

// Verification is read-only: proves every referenced private file exists and
// is readable by the current owner before migration can be marked complete.
router.get("/universe/verify", async (req, res): Promise<void> => {
  // The /universe prefix middleware above also protects this route.
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const envelope = await readUniverse(req.userId!, universeId);
  if (!envelope.state) { res.status(404).json({ error: "Universe not found" }); return; }
  const parsed = SaveUniverseBody.shape.state.safeParse(envelope.state);
  if (!parsed.success) { res.status(422).json({ error: "Invalid saved universe" }); return; }
  const state = parsed.data;
  const refs = [...state.characters.flatMap(c => [c.avatar, ...c.identity.referenceImages]),
    ...state.posts.flatMap(p => [p.image, ...(p.media ?? []).map(item => item.url)]), ...state.stories.map(s => s.image),
    ...state.messages.flatMap(m => (m.attachments ?? []).map(item => item.url))];
  const objects = [...new Set(refs.filter(ref => ref.startsWith("/objects/")))];
  const storage = new ObjectStorageService();
  for (const path of objects) {
    const [owned] = await db.select().from(echoMediaTable).where(and(
      eq(echoMediaTable.ownerId, req.userId!), eq(echoMediaTable.objectPath, path),
    )).limit(1);
    if (!owned) { res.status(422).json({ error: "Una foto no pertenece a esta cuenta" }); return; }
    const file = await storage.getObjectEntityFile(path);
    if (!await storage.canAccessObjectEntity({ userId: req.userId!, objectFile: file, requestedPermission: ObjectPermission.READ })) {
      res.status(422).json({ error: "Una foto no se puede leer" }); return;
    }
    // Consume a full authenticated storage read, rather than only trust metadata.
    const response = await storage.downloadObject(file);
    if (response.status !== 200 || !response.body) { res.status(422).json({ error: "No se pudo verificar una foto" }); return; }
    // Consume fully, retaining SDK integrity validation without a second adapter.
    for await (const _chunk of response.body) { /* verify every stored byte */ }
  }
  res.json({ ...envelope, verifiedFiles: objects.length });
});

export default router;
