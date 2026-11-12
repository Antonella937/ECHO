import { dmCanonCandidates } from "../lib/canon-knowledge";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { db, echoMediaTable, echoUniversesTable } from "@workspace/db";
import { and, eq, inArray, sql } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";
import { ECHO_CREDIT_POLICY, resolveEchoPlan } from "../lib/entitlements";
import { creditWallet } from "../lib/creditWallet";
import {
  configureAiBudget,
  creatorUsageSummary,
  DEFAULT_MONTHLY_HARD_CEILING_UNITS,
  MIN_AUTONOMY_RESERVE_PERCENT,
  MAX_AUTONOMY_RESERVE_PERCENT,
} from "../lib/ai-usage";
import {
  createAdditionalUniverse, creatorEntitlements, creatorCapacity, listUniverses, StructuralLimitError, readUniverse,
} from "../lib/universeRepository";
import { universeAccountError } from "../lib/universeValidation";
import { SaveUniverseBody } from "@workspace/api-zod";
import { UniverseManagementError, manageUniverse } from "../lib/universeManagement";

export function createCreatorRouter(authenticate: RequestHandler = requireAuth): IRouter {
const router: IRouter = Router();
const categories = ["autonomy", "brain_text", "memory_context", "vision", "images"] as const;
const budgetSchema = z.object({
  monthlyHardCeilingUnits: z.number().int().min(1).max(DEFAULT_MONTHLY_HARD_CEILING_UNITS),
  autonomyReservePercent: z.number().int().min(MIN_AUTONOMY_RESERVE_PERCENT).max(MAX_AUTONOMY_RESERVE_PERCENT),
  categoryWeights: z.object({
    autonomy: z.number().int().min(1).max(10000),
    brain_text: z.number().int().min(1).max(10000),
    memory_context: z.number().int().min(1).max(10000),
    vision: z.number().int().min(1).max(10000),
    images: z.number().int().min(1).max(10000),
  }).strict(),
}).strict();
const createUniverseSchema = z.object({
  name: z.string().trim().min(1).max(60),
  state: z.unknown(),
}).strict();

router.use("/creator", authenticate);

// Authenticated catalog for the upcoming server-side wallet.
// No client-supplied plan, balance mutations, or checkout actions are trusted.
router.get("/creator/credits/wallet", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  try { res.json(await creditWallet(req.userId!)); }
  catch (error) { req.log.error({ err: error }, "Credit wallet read failed"); res.status(503).json({ error: "CREDIT_WALLET_UNAVAILABLE" }); }
});

router.post("/creator/credits/daily-reward", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const result = await creditWallet(req.userId!, true);
    if (!result.dailyReward.claimedNow) { res.status(409).json({ error: "DAILY_REWARD_ALREADY_CLAIMED", wallet: result }); return; }
    res.json(result);
  } catch (error) { req.log.error({ err: error }, "Daily credit reward failed"); res.status(503).json({ error: "DAILY_REWARD_UNAVAILABLE" }); }
});

router.get("/creator/credits/catalog", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const plan = await resolveEchoPlan(req.userId!);
    const policy = ECHO_CREDIT_POLICY;
    res.json({
      plan,
      included: policy.monthlyPlans[plan],
      rewardCaps: policy.monthlyRewardCaps[plan],
      rewardExpiresAfterDays: policy.rewardExpiresAfterDays,
      costs: policy.costs,
      packs: policy.packs,
      customVoiceMonthlyMaintenanceCents: policy.customVoiceMonthlyMaintenanceCents,
      walletEnabled: policy.walletEnabled,
      checkoutEnabled: policy.checkoutEnabled,
      balances: null,
      dailyReward: { available: false, reason: "WALLET_NOT_YET_CONNECTED" },
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not resolve credit catalog");
    res.status(503).json({ error: "CREDIT_CATALOG_UNAVAILABLE" });
  }
});

router.get("/creator/account", async (req, res): Promise<void> => {
  const ownerId = req.userId!;
  const [entitlements, membershipPlan] = await Promise.all([creatorEntitlements(ownerId), resolveEchoPlan(ownerId)]);
  const [universes, usage] = await Promise.all([listUniverses(ownerId), creatorUsageSummary(ownerId)]);
  const characterCount = universes.reduce((sum, universe) => {
    const characters = universe.state.characters;
    return sum + (Array.isArray(characters) ? characters.length : 0);
  }, 0);
  res.json({
    plan: membershipPlan,
    lifetimeAccess: lifetimeAccessForOwner(ownerId),
    billingExempt: lifetimeAccessForOwner(ownerId) !== null,
    billingStatus: "not_connected",
    betaAccess: process.env.ECHO_BETA_ACCESS_MODE === "three_seats",
    maxUniverses: creatorCapacity(ownerId, membershipPlan, entitlements.addonCharacters, entitlements.addonUniverses).maxUniverses,
    maxCharacters: creatorCapacity(ownerId, membershipPlan, entitlements.addonCharacters, entitlements.addonUniverses).maxCharacters,
    addonUniverses: entitlements.addonUniverses,
    addonCharacters: entitlements.addonCharacters,
    universeCount: universes.length,
    characterCount,
    usage,
  });
});

// Read-only preview: never deletes files, database records, or Clerk identities.
router.get("/creator/account/deletion-preview", async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const ownerId = req.userId!;
    const [media, universes] = await Promise.all([
      db.select({ ownerId: echoMediaTable.ownerId, objectPath: echoMediaTable.objectPath })
        .from(echoMediaTable).where(eq(echoMediaTable.ownerId, ownerId)),
      listUniverses(ownerId),
    ]);
    const { planOwnedMediaDeletion } = await import("../lib/accountDeletionPlan");
    const plan = planOwnedMediaDeletion(ownerId, media);
    res.json({
      status: "PREVIEW_ONLY",
      ownerId,
      universeCount: universes.length,
      mediaCount: plan.objectPaths.length,
      willDelete: false,
      warning: "No account deletion executor is enabled. Provider files, account and backups are untouched.",
    });
  } catch (error) {
    req.log.error({ err: error }, "Could not build account deletion preview");
    res.status(503).json({ error: "DELETION_PREVIEW_UNAVAILABLE" });
  }
});

router.put("/creator/ai-budget", async (req, res): Promise<void> => {
  const parsed = budgetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_AI_BUDGET" }); return; }
  const ownerId = req.userId!;
  const usage = await configureAiBudget(ownerId, parsed.data);
  const [entitlements, membershipPlan, universes] = await Promise.all([creatorEntitlements(ownerId), resolveEchoPlan(ownerId), listUniverses(ownerId)]);
  const characterCount = universes.reduce((sum, universe) => sum +
    (Array.isArray(universe.state.characters) ? universe.state.characters.length : 0), 0);
  res.json({
    plan: membershipPlan, lifetimeAccess: lifetimeAccessForOwner(ownerId),
    billingExempt: lifetimeAccessForOwner(ownerId) !== null, billingStatus: "not_connected",
    maxUniverses: creatorCapacity(ownerId, membershipPlan, entitlements.addonCharacters, entitlements.addonUniverses).maxUniverses,
    maxCharacters: creatorCapacity(ownerId, membershipPlan, entitlements.addonCharacters, entitlements.addonUniverses).maxCharacters,
    addonUniverses: entitlements.addonUniverses, addonCharacters: entitlements.addonCharacters,
    universeCount: universes.length, characterCount, usage,
  });
});

router.get("/creator/universes", async (req, res): Promise<void> => {
  const ownerId = req.userId!;
  const currentId = typeof req.query.universeId === "string" ? req.query.universeId : "primary";
  const universes = await listUniverses(ownerId);
  res.json(universes.map(universe => ({
    universeId: universe.universeId,
    name: (universe.state.creatorSetup as { universeName?: string } | undefined)?.universeName ?? "Mi universo",
    revision: universe.revision,
    characterCount: Array.isArray(universe.state.characters) ? universe.state.characters.length : 0,
    current: universe.universeId === currentId,
    archived: Boolean(universe.archivedAt),
    description: (universe.state.creatorSetup as { universeDescription?: string } | undefined)?.universeDescription ?? "",
    timeline: (universe.state.creatorSetup as { universeTimeline?: string } | undefined)?.universeTimeline ?? "",
  })));
});

router.put("/creator/universes/:universeId/management", async (req, res): Promise<void> => {
  const input = z.object({
    action: z.enum(["edit", "archive", "restore", "delete"]),
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().max(8000).optional(),
    timeline: z.string().max(4000).optional(),
    confirmationText: z.string().max(80).optional(),
  }).strict().safeParse(req.body);
  if (!input.success || typeof req.params.universeId !== "string" || req.params.universeId.length > 80) {
    res.status(400).json({ error: "INVALID_UNIVERSE_OPERATION" }); return;
  }
  try { res.json(await manageUniverse(req.userId!, req.params.universeId, input.data)); }
  catch (error) {
    if (error instanceof UniverseManagementError) { res.status(error.status).json({ error: error.message }); return; }
    throw error;
  }
});

router.post("/creator/universes", async (req, res): Promise<void> => {
  const input = createUniverseSchema.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: "INVALID_UNIVERSE_INPUT" }); return; }
  const parsed = SaveUniverseBody.shape.state.safeParse(input.data.state);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_UNIVERSE_STATE" }); return; }
  const state = parsed.data;
  const accountError = universeAccountError(state);
  if (accountError) { res.status(400).json({ error: accountError }); return; }
  if (!state.characters.some(character => character.id === "nela" && !character.archived) ||
      !state.characters.some(character => character.id === state.currentCharacterId && !character.archived)) {
    res.status(400).json({ error: "INVALID_PRIMARY_IDENTITY" }); return;
  }
  const refs = [
    ...state.characters.flatMap(character => [character.avatar, ...character.identity.referenceImages]),
    ...state.posts.flatMap(post => [post.image, ...(post.media ?? []).map(item => item.url)]),
    ...state.stories.map(story => story.image),
    ...state.messages.flatMap(message => (message.attachments ?? []).map(item => item.url)),
  ];
  if (refs.some(ref => !ref.startsWith("asset:") && !/^\/objects\/uploads\/[a-f0-9-]+$/i.test(ref))) {
    res.status(400).json({ error: "INVALID_PRIVATE_MEDIA_REFERENCE" }); return;
  }
  const objects = [...new Set(refs.filter(ref => ref.startsWith("/objects/")))];
  if (objects.length) {
    const owned = await db.select({ path: echoMediaTable.objectPath }).from(echoMediaTable)
      .where(and(eq(echoMediaTable.ownerId, req.userId!), inArray(echoMediaTable.objectPath, objects)));
    if (owned.length !== objects.length) { res.status(400).json({ error: "MEDIA_NOT_OWNED" }); return; }
  }
  try {
    const created = await createAdditionalUniverse(req.userId!, input.data.name, state as Record<string, unknown>);
    res.status(201).json(created);
  } catch (error) {
    if (error instanceof StructuralLimitError) {
      res.status(409).json({ error: error.code });
      return;
    }
    throw error;
  }
});

// DM review is owner-scoped, universe-scoped and bound to the active identity.
router.get("/creator/universes/:universeId/dm-canon-candidates/:peerId", async (req, res) => {
  const universeId = z.string().min(1).max(120).safeParse(req.params.universeId);
  const peerId = z.string().min(1).max(120).safeParse(req.params.peerId);
  if (!universeId.success || !peerId.success) { res.status(400).json({ error: "INVALID_DM_SCOPE" }); return; }
  try {
    const universe = await readUniverse(req.userId!, universeId.data);
    const state = universe.state;
    if (!state) { res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return; }
    const viewerId = state.currentCharacterId;
    if (typeof viewerId !== "string" || viewerId === peerId.data ||
      !Array.isArray(state.characters) ||
      !state.characters.some((character: {id?:unknown;archived?:unknown}) => character.id === viewerId && character.archived !== true) ||
      !state.characters.some((character: {id?:unknown;archived?:unknown}) => character.id === peerId.data && character.archived !== true)) {
      res.status(403).json({ error: "DM_VIEWER_NOT_ALLOWED" }); return;
    }
    const messages = Array.isArray(state.messages) ? state.messages : [];
    const setup = (state.creatorSetup ?? {}) as Record<string, unknown>;
    const entries = Array.isArray(setup.canonKnowledgeEvents) ? setup.canonKnowledgeEvents : [];
    const dismissed = Array.isArray(setup.dismissedCanonEventIds) ? setup.dismissedCanonEventIds : [];
    const candidates = dmCanonCandidates(messages, viewerId, peerId.data).filter(item => {
      const key = `dm:${[viewerId, peerId.data].sort().join(":")}:${item.sourceId}`;
      return !dismissed.includes(key) && !entries.some(entry =>
        entry && typeof entry === "object" && (entry as Record<string, unknown>).sourceKey === key);
    });
    res.json({ candidates });
  } catch { res.status(503).json({ error: "DM_CANON_CANDIDATES_UNAVAILABLE" }); }
});


const dmCanonAction = z.object({
  text: z.string().trim().min(1).max(1200).optional(),
  action: z.enum(["approve","dismiss"]),
}).strict();
router.post("/creator/universes/:universeId/dm-canon-candidates/:peerId/:messageId/decision", async (req, res) => {
  const universeId = z.string().min(1).max(120).safeParse(req.params.universeId);
  const peerId = z.string().min(1).max(120).safeParse(req.params.peerId);
  const messageId = z.string().min(1).max(120).safeParse(req.params.messageId);
  const decision = dmCanonAction.safeParse(req.body);
  if (!universeId.success || !peerId.success || !messageId.success || !decision.success) {
    res.status(400).json({ error: "INVALID_CANON_DECISION" }); return;
  }
  try {
    const result = await db.transaction(async tx => {
      const [universe] = await tx.select().from(echoUniversesTable)
        .where(and(eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId.data)))
        .for("update").limit(1);
      if (!universe || universe.archivedAt || universe.deletedAt) return { status: 404, error: "UNIVERSE_NOT_FOUND" };
      const state = universe.state;
      const viewerId = state.currentCharacterId;
      const characters = Array.isArray(state.characters) ? state.characters as Array<{id?: string; archived?: boolean}> : [];
      if (typeof viewerId !== "string" || viewerId === peerId.data ||
        !characters.some(ch => ch.id === viewerId && !ch.archived) ||
        !characters.some(ch => ch.id === peerId.data && !ch.archived)) {
        return { status: 403, error: "DM_VIEWER_NOT_ALLOWED" };
      }
      const candidate = dmCanonCandidates(state.messages as unknown as Array<Record<string,unknown>>, viewerId, peerId.data)
        .find(item => item.sourceId === messageId.data);
      if (!candidate) return { status: 404, error: "CANON_CANDIDATE_NOT_FOUND" };
      const setup = (state.creatorSetup ?? {}) as Record<string, unknown>;
      const entries = Array.isArray(setup.canonKnowledgeEvents) ? setup.canonKnowledgeEvents : [];
      const dismissed = Array.isArray(setup.dismissedCanonEventIds) ? setup.dismissedCanonEventIds : [];
      const key = `dm:${[viewerId, peerId.data].sort().join(":")}:${messageId.data}`;
      if (entries.some(item => item && typeof item === "object" && (item as Record<string,unknown>).sourceKey === key) ||
          dismissed.includes(key)) return { status: 200, duplicate: true };
      const nextSetup = decision.data.action === "dismiss"
        ? { ...setup, dismissedCanonEventIds: [...dismissed.slice(-999), key] }
        : { ...setup, canonKnowledgeEvents: [...entries.slice(-199), {
            sourceKey: key, text: decision.data.text ?? candidate.text,
            visibility: "participants", witnessIds: candidate.witnessIds,
            occurredAt: candidate.occurredAt,
          }] };
      await tx.update(echoUniversesTable).set({
        state: { ...state, creatorSetup: nextSetup },
        revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date(),
      }).where(and(eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId.data)));
      return { status: 200, saved: true };
    });
    if ("error" in result) { res.status(result.status).json({ error: result.error }); return; }
    res.json(result);
  } catch { res.status(503).json({ error: "CANON_DECISION_UNAVAILABLE" }); }
});

return router;
}
export default createCreatorRouter();
