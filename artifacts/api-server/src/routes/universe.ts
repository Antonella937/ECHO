import {
  GetUniverseResponse,
  SaveUniverseBody,
  SaveUniverseResponse,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse, writeUniverse, StructuralLimitError } from "../lib/universeRepository";
import { db, echoMediaTable, echoUniversesTable, echoMemoryArchiveTable } from "@workspace/db";
import { and, desc, eq, inArray } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { ObjectPermission } from "../lib/objectAcl";
import { universeAccountError } from "../lib/universeValidation";
import { recordIncomingConversationEvents } from "../ai-engine/incoming-memory";
import { approveRelationshipProgression } from "../lib/relationshipApproval";
import { approveTrustEvent } from "../lib/relationshipTrustApproval";
import { suggestTrustCandidates } from "../lib/relationshipTrustCandidates";
import { echoRelationshipLedgerTable } from "@workspace/db";
import type { TrustEventKind } from "../lib/relationshipTrust";
import { sendNewOwnerPush } from "../lib/onesignal-push";

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

// Private historical lookup, never exposed across owners or universes.
router.get("/universe/memory-archive", async (req, res): Promise<void> => {
  if (process.env.ECHO_MEMORY_ARCHIVE_ENABLED !== "true") {
    res.status(503).json({ error: "MEMORY_ARCHIVE_NOT_ENABLED" }); return;
  }
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const characterId = typeof req.query.characterId === "string" ? req.query.characterId : "";
  if (!characterId || characterId.length > 100) {
    res.status(400).json({ error: "CHARACTER_ID_REQUIRED" }); return;
  }
  const envelope = await readUniverse(req.userId!, universeId);
  const state = SaveUniverseBody.shape.state.safeParse(envelope.state);
  if (!state.success || !state.data.characters.some(c => c.id === characterId && !c.archived)) {
    res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return;
  }
  const memories = await db.select({
    memoryId: echoMemoryArchiveTable.memoryId,
    sourceId: echoMemoryArchiveTable.sourceId,
    kind: echoMemoryArchiveTable.kind,
    targetId: echoMemoryArchiveTable.targetId,
    content: echoMemoryArchiveTable.content,
    occurredAt: echoMemoryArchiveTable.occurredAt,
  }).from(echoMemoryArchiveTable).where(and(
    eq(echoMemoryArchiveTable.ownerId, req.userId!),
    eq(echoMemoryArchiveTable.universeId, universeId),
    eq(echoMemoryArchiveTable.characterId, characterId),
  )).orderBy(desc(echoMemoryArchiveTable.occurredAt)).limit(50);
  res.json({ memories });
});

// This endpoint is intentionally user-triggered; no autonomous worker calls it.
router.post("/universe/relationships/approve", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | null;
  const actorId = body?.actorId;
  const targetId = body?.targetId;
  const expectedRevision = body?.expectedRevision;
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      !Number.isSafeInteger(expectedRevision) || (expectedRevision as number) < 1 ||
      universeId.length > 100) {
    res.status(400).json({ error: "INVALID_RELATIONSHIP_APPROVAL" }); return;
  }
  const result = await approveRelationshipProgression(
    req.userId!, universeId, actorId, targetId, expectedRevision as number,
  );
  if (!result.applied) {
    const conflict = result.reason === "REVISION_CONFLICT" || result.reason === "UNIVERSE_UNAVAILABLE";
    res.status(conflict ? 409 : 422).json(result); return;
  }
  res.json(result);
});

// Owner-scoped, read-only relationship trust history.
router.get("/universe/relationships/trust/history", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = req.query.actorId, targetId = req.query.targetId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TRUST_HISTORY_QUERY" }); return;
  }
  const [universe] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const entries = await db.select({
    memoryId: echoMemoryArchiveTable.memoryId,
    sourceId: echoMemoryArchiveTable.sourceId,
    content: echoMemoryArchiveTable.content,
    occurredAt: echoMemoryArchiveTable.occurredAt,
  }).from(echoMemoryArchiveTable).where(and(
    eq(echoMemoryArchiveTable.ownerId, req.userId!),
    eq(echoMemoryArchiveTable.universeId, universeId),
    eq(echoMemoryArchiveTable.characterId, actorId),
    eq(echoMemoryArchiveTable.targetId, targetId),
    eq(echoMemoryArchiveTable.kind, "relationship_trust"),
  )).orderBy(desc(echoMemoryArchiveTable.occurredAt)).limit(50);
  res.json({ entries });
});

// Read-only candidate review. Never changes trust or marks evidence verified.
router.get("/universe/relationships/trust/candidates", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = req.query.actorId, targetId = req.query.targetId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TRUST_CANDIDATE_QUERY" }); return;
  }
  const scope = and(eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId));
  const [universe] = await db.select().from(echoUniversesTable).where(scope).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
  if (!parsed.success) {
    res.status(422).json({ error: "INVALID_SAVED_STATE" }); return;
  }
  const [ledger] = await db.select().from(echoRelationshipLedgerTable).where(and(
    eq(echoRelationshipLedgerTable.ownerId, req.userId!),
    eq(echoRelationshipLedgerTable.universeId, universeId),
    eq(echoRelationshipLedgerTable.actorId, actorId),
    eq(echoRelationshipLedgerTable.targetId, targetId),
  )).limit(1);
  res.json({
    revision: universe.revision,
    candidates: suggestTrustCandidates(parsed.data, actorId, targetId, ledger?.consumedMessageIds ?? []),
  });
});

// A saved direct message is required as evidence; the authenticated owner
// explicitly confirms its meaning. No AI-generated trust changes occur here.
router.post("/universe/relationships/trust/approve", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | null;
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const kinds: readonly string[] = [
    "promise_kept", "support_given", "boundary_respected", "lie_confirmed",
    "promise_broken", "betrayal_confirmed", "repair_confirmed",
  ];
  const actorId = body?.actorId, targetId = body?.targetId;
  const sourceId = body?.sourceId, kind = body?.kind, revision = body?.expectedRevision;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      typeof sourceId !== "string" || !sourceId || sourceId.length > 200 ||
      typeof kind !== "string" || !kinds.includes(kind) ||
      !Number.isSafeInteger(revision) || (revision as number) < 1 ||
      universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TRUST_APPROVAL" }); return;
  }
  const result = await approveTrustEvent(
    req.userId!, universeId, actorId, targetId, sourceId,
    kind as TrustEventKind, revision as number,
  );
  if (!result.applied) {
    res.status(["REVISION_CONFLICT", "UNIVERSE_UNAVAILABLE"].includes(result.reason) ? 409 : 422).json(result);
    return;
  }
  res.json(result);
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
  try { saved = await writeUniverse(req.userId!, { ...enrichedState }, expectedRevision, universeId); }
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
  // Dispatch only committed new notifications to the authenticated owner.
  if (previousState.success && previous.revision === expectedRevision && process.env.ECHO_ONESIGNAL_REST_API_KEY) {
    void sendNewOwnerPush(req.userId!, previousState.data, enrichedState).catch(error => {
      console.warn("OneSignal dispatch failed", { reason: error instanceof Error ? error.name : "UNKNOWN" });
    });
  }
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
