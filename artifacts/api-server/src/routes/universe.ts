import { triggerImmediateDmReply } from "../autonomy/runtime";
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
import { approveTensionEvent } from "../lib/relationshipTensionApproval";
import { approveAttractionEvent } from "../lib/relationshipAttractionApproval";
import { approveRelationshipTransition } from "../lib/relationshipTransitionApproval";
import { proposeRelationshipTransitions, type RelationshipPreset } from "../lib/relationshipTransitions";
import type { AttractionEventKind } from "../lib/relationshipAttraction";
import { FreeModelProvider } from "../ai-engine/free-models";
import { assessTrustContext } from "../lib/relationshipTrustContext";
import type { TensionEventKind } from "../lib/relationshipTension";
import { suggestTrustCandidates } from "../lib/relationshipTrustCandidates";
import { echoRelationshipLedgerTable } from "@workspace/db";
import type { TrustEventKind } from "../lib/relationshipTrust";
import { sendNewOwnerPush } from "../lib/onesignal-push";

const router: IRouter = Router();

router.use("/universe", requireAuth);

// Lightweight owner-scoped revision probe. Never returns the universe JSON payload.
router.get("/universe/revision", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  if (!universeId || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_UNIVERSE_ID" }); return;
  }
  const [row] = await db.select({
    revision: echoUniversesTable.revision,
    archivedAt: echoUniversesTable.archivedAt,
    deletedAt: echoUniversesTable.deletedAt,
  }).from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!),
    eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (row?.archivedAt || row?.deletedAt) {
    res.status(409).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  res.setHeader("Cache-Control", "no-store");
  res.json({ revision: row?.revision ?? 0 });
});

router.get("/universe", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const [meta] = await db.select().from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId)));
  if (meta?.archivedAt || meta?.deletedAt) {
    const available = await db.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, req.userId!));
    res.status(409).json({ error: "UNIVERSE_UNAVAILABLE", ownerId: req.userId!, fallbackUniverseId: available.find(row => !row.archivedAt && !row.deletedAt)?.universeId ?? null }); return;
  }
  res.json(GetUniverseResponse.parse(await readUniverse(req.userId!, universeId)));
});

// Read-only, owner-isolated paginated profile listing. Transitional endpoint:
// the legacy JSON universe remains authoritative until partitioned storage is migrated.
router.get("/universe/characters/page", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  if (!universeId || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_UNIVERSE_ID" }); return;
  }
  const rawLimit = typeof req.query.limit === "string" ? Number(req.query.limit) : 24;
  const rawOffset = typeof req.query.offset === "string" ? Number(req.query.offset) : 0;
  if (!Number.isSafeInteger(rawLimit) || rawLimit < 1 || rawLimit > 50 ||
      !Number.isSafeInteger(rawOffset) || rawOffset < 0 || rawOffset > 1000000) {
    res.status(400).json({ error: "INVALID_PAGINATION" }); return;
  }
  const envelope = await readUniverse(req.userId!, universeId);
  const state = SaveUniverseBody.shape.state.safeParse(envelope.state);
  if (!state.success) {
    res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return;
  }
  const characters = state.data.characters.filter(character => !character.archived);
  const page = characters.slice(rawOffset, rawOffset + rawLimit).map(character => ({
    id: character.id,
    personId: character.personId ?? character.id,
    handle: character.handle,
    name: character.name,
    occupation: character.occupation,
    bio: character.bio,
    avatar: character.avatar,
    accountType: character.accountType ?? "personal",
    verified: character.verified ?? false,
    privateAccount: character.privateAccount ?? false,
    displayMetrics: character.displayMetrics ?? null,
  }));
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ characters: page, total: characters.length,
    nextOffset: rawOffset + page.length < characters.length ? rawOffset + page.length : null,
    revision: envelope.revision });
});

// Transitional paginated feed projection. Full-state writes remain authoritative.
// Sort deterministically to avoid unstable pages for equal timestamps.
router.get("/universe/posts/page", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const authorId = typeof req.query.authorId === "string" ? req.query.authorId : null;
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 20;
  const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : 0;
  if (!universeId || universeId.length > 100 ||
      (authorId !== null && (!authorId || authorId.length > 100)) ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    res.status(400).json({ error: "INVALID_PAGE_QUERY" }); return;
  }
  const envelope = await readUniverse(req.userId!, universeId);
  const parsed = SaveUniverseBody.shape.state.safeParse(envelope.state);
  if (!parsed.success) {
    res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return;
  }
  if (authorId && !parsed.data.characters.some(character => character.id === authorId && !character.archived)) {
    res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return;
  }
  const posts = parsed.data.posts
    .filter(post => authorId === null || post.authorId === authorId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const page = posts.slice(offset, offset + limit);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ posts: page, total: posts.length,
    nextOffset: offset + page.length < posts.length ? offset + page.length : null,
    revision: envelope.revision });
});

// Transitional, owner-scoped paginated conversation history.
// Keeps the existing universe JSON as source of truth until the database backfill is verified.
router.get("/universe/messages/page", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const threadId = typeof req.query.threadId === "string" ? req.query.threadId : "";
  const limit = typeof req.query.limit === "string" ? Number(req.query.limit) : 30;
  const offset = typeof req.query.offset === "string" ? Number(req.query.offset) : 0;
  if (!universeId || universeId.length > 100 || !threadId || threadId.length > 250 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50 ||
      !Number.isSafeInteger(offset) || offset < 0 || offset > 1000000) {
    res.status(400).json({ error: "INVALID_MESSAGE_PAGE" }); return;
  }
  const envelope = await readUniverse(req.userId!, universeId);
  const parsed = SaveUniverseBody.shape.state.safeParse(envelope.state);
  if (!parsed.success) {
    res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return;
  }
  const messages = parsed.data.messages.filter(message => message.threadId === threadId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.id.localeCompare(a.id));
  const page = messages.slice(offset, offset + limit);
  res.setHeader("Cache-Control", "private, no-store");
  res.json({ messages: page, total: messages.length,
    nextOffset: offset + page.length < messages.length ? offset + page.length : null,
    revision: envelope.revision });
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

// Contextual AI is opt-in and read-only; a model can never approve evidence.
router.post("/universe/relationships/trust/context", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | null;
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = body?.actorId, targetId = body?.targetId, sourceId = body?.sourceId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      typeof sourceId !== "string" || !sourceId || sourceId.length > 200 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_CONTEXT_REQUEST" }); return;
  }
  const [universe] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
  if (!parsed.success) { res.status(422).json({ error: "INVALID_SAVED_STATE" }); return; }
  const relation = parsed.data.characters.find(c => c.id === actorId && !c.archived)
    ?.configuration?.relationships.find(r => r.targetId === targetId);
  const message = parsed.data.messages.find(m => m.id === sourceId &&
    !m.hiddenForIds?.includes(actorId) &&
    ((m.senderId === actorId && m.recipientId === targetId) ||
     (m.senderId === targetId && m.recipientId === actorId)));
  if (!relation || !message) { res.status(404).json({ error: "EVIDENCE_NOT_FOUND" }); return; }
  const conversation = parsed.data.messages.filter(m =>
    ((m.senderId === actorId && m.recipientId === targetId) ||
     (m.senderId === targetId && m.recipientId === actorId)) &&
    !m.hiddenForIds?.includes(actorId) &&
    new Date(m.createdAt).getTime() <= new Date(message.createdAt).getTime()
  ).sort((a, b) => new Date(a.createdAt).getTime() - new Date(b.createdAt).getTime());
  const index = conversation.findIndex(m => m.id === sourceId);
  const previousMessages = conversation.slice(Math.max(0, index - 8), index).map(m => m.text);
  if (!process.env.OPENROUTER_API_KEY) {
    res.status(503).json({ error: "CONTEXT_AI_NOT_CONFIGURED" }); return;
  }
  try {
    const assessment = await assessTrustContext(new FreeModelProvider(), {
      message: message.text, previousMessages,
      relationshipDescription: [relation.description].filter(Boolean).join("\n"),
    });
    res.json({ sourceId, ...assessment });
  } catch {
    res.status(503).json({ error: "CONTEXT_AI_UNAVAILABLE" });
  }
});

// Read-only tension evidence. Owner must explicitly select the event meaning.
router.get("/universe/relationships/tension/candidates", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = req.query.actorId, targetId = req.query.targetId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TENSION_QUERY" }); return;
  }
  const [universe] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
  if (!parsed.success) { res.status(422).json({ error: "INVALID_SAVED_STATE" }); return; }
  const relation = parsed.data.characters.find(c => c.id === actorId && !c.archived)
    ?.configuration?.relationships.find(r => r.targetId === targetId);
  if (!relation || relation.tension == null) { res.json({ revision: universe.revision, candidates: [] }); return; }
  const [ledger] = await db.select().from(echoRelationshipLedgerTable).where(and(
    eq(echoRelationshipLedgerTable.ownerId, req.userId!), eq(echoRelationshipLedgerTable.universeId, universeId),
    eq(echoRelationshipLedgerTable.actorId, actorId), eq(echoRelationshipLedgerTable.targetId, targetId),
  )).limit(1);
  const now = Date.now();
  const candidates = parsed.data.messages.filter(m =>
    ((m.senderId === actorId && m.recipientId === targetId) ||
     (m.senderId === targetId && m.recipientId === actorId)) &&
    !m.hiddenForIds?.includes(actorId) &&
    !ledger?.consumedMessageIds?.includes(`tension:${m.id}`) &&
    new Date(m.createdAt).getTime() <= now &&
    new Date(m.createdAt).getTime() >= now - 30 * 24 * 60 * 60_000
  ).slice(-20).map(m => ({ sourceId: m.id, excerpt: m.text.slice(0, 280), occurredAt: m.createdAt }));
  res.json({ revision: universe.revision, candidates });
});

router.get("/universe/relationships/tension/history", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = req.query.actorId, targetId = req.query.targetId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TENSION_HISTORY_QUERY" }); return;
  }
  const [universe] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const entries = await db.select({
    memoryId: echoMemoryArchiveTable.memoryId, sourceId: echoMemoryArchiveTable.sourceId,
    content: echoMemoryArchiveTable.content, occurredAt: echoMemoryArchiveTable.occurredAt,
  }).from(echoMemoryArchiveTable).where(and(
    eq(echoMemoryArchiveTable.ownerId, req.userId!), eq(echoMemoryArchiveTable.universeId, universeId),
    eq(echoMemoryArchiveTable.characterId, actorId), eq(echoMemoryArchiveTable.targetId, targetId),
    eq(echoMemoryArchiveTable.kind, "relationship_tension"),
  )).orderBy(desc(echoMemoryArchiveTable.occurredAt)).limit(50);
  res.json({ entries });
});

router.post("/universe/relationships/tension/approve", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | null;
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const kinds: readonly string[] = [
    "argument_confirmed", "boundary_crossed", "unresolved_conflict",
    "apology_accepted", "reconciliation_confirmed", "conflict_resolved",
  ];
  const actorId = body?.actorId, targetId = body?.targetId;
  const sourceId = body?.sourceId, kind = body?.kind, revision = body?.expectedRevision;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      typeof sourceId !== "string" || !sourceId || sourceId.length > 200 ||
      typeof kind !== "string" || !kinds.includes(kind) ||
      !Number.isSafeInteger(revision) || (revision as number) < 1 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TENSION_APPROVAL" }); return;
  }
  const result = await approveTensionEvent(
    req.userId!, universeId, actorId, targetId, sourceId,
    kind as TensionEventKind, revision as number,
  );
  if (!result.applied) {
    res.status(["REVISION_CONFLICT", "UNIVERSE_UNAVAILABLE"].includes(result.reason) ? 409 : 422).json(result);
    return;
  }
  res.json(result);
});

router.get("/universe/relationships/attraction/candidates", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = req.query.actorId, targetId = req.query.targetId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_ATTRACTION_QUERY" }); return;
  }
  const [universe] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
  if (!parsed.success) { res.status(422).json({ error: "INVALID_SAVED_STATE" }); return; }
  const relation = parsed.data.characters.find(c => c.id === actorId && !c.archived)
    ?.configuration?.relationships.find(r => r.targetId === targetId);
  if (!relation || relation.attraction == null) { res.json({ revision: universe.revision, candidates: [] }); return; }
  const [ledger] = await db.select().from(echoRelationshipLedgerTable).where(and(
    eq(echoRelationshipLedgerTable.ownerId, req.userId!), eq(echoRelationshipLedgerTable.universeId, universeId),
    eq(echoRelationshipLedgerTable.actorId, actorId), eq(echoRelationshipLedgerTable.targetId, targetId),
  )).limit(1);
  const now = Date.now();
  const candidates = parsed.data.messages.filter(m =>
    ((m.senderId === actorId && m.recipientId === targetId) ||
     (m.senderId === targetId && m.recipientId === actorId)) &&
    !m.hiddenForIds?.includes(actorId) &&
    !ledger?.consumedMessageIds?.includes(`attraction:${m.id}`) &&
    new Date(m.createdAt).getTime() <= now &&
    new Date(m.createdAt).getTime() >= now - 30 * 24 * 60 * 60_000
  ).slice(-20).map(m => ({ sourceId: m.id, excerpt: m.text.slice(0, 280), occurredAt: m.createdAt }));
  res.json({ revision: universe.revision, candidates });
});

router.get("/universe/relationships/attraction/history", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = req.query.actorId, targetId = req.query.targetId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_ATTRACTION_HISTORY_QUERY" }); return;
  }
  const [universe] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const entries = await db.select({
    memoryId: echoMemoryArchiveTable.memoryId, sourceId: echoMemoryArchiveTable.sourceId,
    content: echoMemoryArchiveTable.content, occurredAt: echoMemoryArchiveTable.occurredAt,
  }).from(echoMemoryArchiveTable).where(and(
    eq(echoMemoryArchiveTable.ownerId, req.userId!), eq(echoMemoryArchiveTable.universeId, universeId),
    eq(echoMemoryArchiveTable.characterId, actorId), eq(echoMemoryArchiveTable.targetId, targetId),
    eq(echoMemoryArchiveTable.kind, "relationship_attraction"),
  )).orderBy(desc(echoMemoryArchiveTable.occurredAt)).limit(50);
  res.json({ entries });
});

router.post("/universe/relationships/attraction/approve", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | null;
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const kinds: readonly string[] = [
    "mutual_flirting_confirmed", "affection_reciprocated", "romantic_interest_confirmed",
    "romantic_boundary_respected", "romantic_interest_declined", "romantic_distance_confirmed",
  ];
  const actorId = body?.actorId, targetId = body?.targetId;
  const sourceId = body?.sourceId, kind = body?.kind, revision = body?.expectedRevision;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      typeof sourceId !== "string" || !sourceId || sourceId.length > 200 ||
      typeof kind !== "string" || !kinds.includes(kind) ||
      !Number.isSafeInteger(revision) || (revision as number) < 1 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_ATTRACTION_APPROVAL" }); return;
  }
  const result = await approveAttractionEvent(
    req.userId!, universeId, actorId, targetId, sourceId,
    kind as AttractionEventKind, revision as number,
  );
  if (!result.applied) {
    res.status(["REVISION_CONFLICT", "UNIVERSE_UNAVAILABLE"].includes(result.reason) ? 409 : 422).json(result);
    return;
  }
  res.json(result);
});

router.get("/universe/relationships/transitions", async (req, res): Promise<void> => {
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = req.query.actorId, targetId = req.query.targetId;
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TRANSITION_QUERY" }); return;
  }
  const [universe] = await db.select().from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) {
    res.status(404).json({ error: "UNIVERSE_UNAVAILABLE" }); return;
  }
  const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
  if (!parsed.success) { res.status(422).json({ error: "INVALID_SAVED_STATE" }); return; }
  const proposals = proposeRelationshipTransitions(parsed.data, actorId, targetId);
  const history = await db.select({
    memoryId: echoMemoryArchiveTable.memoryId, content: echoMemoryArchiveTable.content,
    occurredAt: echoMemoryArchiveTable.occurredAt,
  }).from(echoMemoryArchiveTable).where(and(
    eq(echoMemoryArchiveTable.ownerId, req.userId!), eq(echoMemoryArchiveTable.universeId, universeId),
    eq(echoMemoryArchiveTable.characterId, actorId), eq(echoMemoryArchiveTable.targetId, targetId),
    eq(echoMemoryArchiveTable.kind, "relationship_transition"),
  )).orderBy(desc(echoMemoryArchiveTable.occurredAt)).limit(30);
  res.json({ revision: universe.revision, proposals, history });
});

router.post("/universe/relationships/transitions/approve", async (req, res): Promise<void> => {
  const body = req.body as Record<string, unknown> | null;
  const universeId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const actorId = body?.actorId, targetId = body?.targetId;
  const from = body?.from, to = body?.to, revision = body?.expectedRevision;
  const presets: readonly string[] = ["stranger", "acquaintance", "friend", "close_friend", "family", "crush", "romantic_tension", "partner", "ex", "rival", "custom"];
  if (typeof actorId !== "string" || !actorId || actorId.length > 100 ||
      typeof targetId !== "string" || !targetId || targetId.length > 100 ||
      typeof from !== "string" || !presets.includes(from) ||
      typeof to !== "string" || !presets.includes(to) ||
      !Number.isSafeInteger(revision) || (revision as number) < 1 || universeId.length > 100) {
    res.status(400).json({ error: "INVALID_TRANSITION_APPROVAL" }); return;
  }
  const result = await approveRelationshipTransition(
    req.userId!, universeId, actorId, targetId,
    from as RelationshipPreset, to as RelationshipPreset, revision as number,
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
  if (refs.some(ref => !ref.startsWith("asset:") && ref !== "/voice-tests/echo-m-02.wav" && !/^\/objects\/uploads\/[a-f0-9-]+$/i.test(ref))) {
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
  // Fire only for newly committed, human-authored DMs. This is independent of
  // the periodic autonomy worker and does not trigger on AI-generated saves.
  if (previousState.success && previous.revision === expectedRevision) {
    const oldIds = new Set(previousState.data.messages.map(message => message.id));
    const incoming = enrichedState.messages.filter(message =>
      !oldIds.has(message.id) && message.senderId === enrichedState.currentCharacterId &&
      message.recipientId !== message.senderId && message.text.trim().length > 0 &&
      !message.hiddenForIds?.includes(message.recipientId));
    for (const message of incoming) {
      void triggerImmediateDmReply(req.userId!, universeId, message.recipientId, message.id)
        .catch(error => console.warn("Immediate DM reply failed", { reason: error instanceof Error ? error.message.slice(0,80) : "UNKNOWN" }));
    }
  }
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
