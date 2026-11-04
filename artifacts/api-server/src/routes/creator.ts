import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { db, echoMediaTable } from "@workspace/db";
import { and, eq, inArray } from "drizzle-orm";
import { requireAuth } from "../middlewares/requireAuth";
import {
  configureAiBudget,
  creatorUsageSummary,
  DEFAULT_MONTHLY_HARD_CEILING_UNITS,
  MIN_AUTONOMY_RESERVE_PERCENT,
  MAX_AUTONOMY_RESERVE_PERCENT,
} from "../lib/ai-usage";
import {
  createAdditionalUniverse, creatorEntitlements, listUniverses, StructuralLimitError,
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

router.get("/creator/account", async (req, res): Promise<void> => {
  const ownerId = req.userId!;
  const entitlements = await creatorEntitlements(ownerId);
  const [universes, usage] = await Promise.all([listUniverses(ownerId), creatorUsageSummary(ownerId)]);
  const characterCount = universes.reduce((sum, universe) => {
    const characters = universe.state.characters;
    return sum + (Array.isArray(characters) ? characters.length : 0);
  }, 0);
  res.json({
    plan: entitlements.plan,
    billingStatus: "not_connected",
    betaAccess: process.env.ECHO_BETA_ACCESS_MODE === "three_seats",
    maxUniverses: (process.env.ECHO_BETA_ACCESS_MODE === "three_seats" || entitlements.plan === "creator" ? 5 : 1) + entitlements.addonUniverses,
    maxCharacters: (process.env.ECHO_BETA_ACCESS_MODE === "three_seats" || entitlements.plan === "creator" ? 25 : 5) + entitlements.addonCharacters,
    addonUniverses: entitlements.addonUniverses,
    addonCharacters: entitlements.addonCharacters,
    universeCount: universes.length,
    characterCount,
    usage,
  });
});

router.put("/creator/ai-budget", async (req, res): Promise<void> => {
  const parsed = budgetSchema.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_AI_BUDGET" }); return; }
  const ownerId = req.userId!;
  const usage = await configureAiBudget(ownerId, parsed.data);
  const [entitlements, universes] = await Promise.all([creatorEntitlements(ownerId), listUniverses(ownerId)]);
  const characterCount = universes.reduce((sum, universe) => sum +
    (Array.isArray(universe.state.characters) ? universe.state.characters.length : 0), 0);
  res.json({
    plan: entitlements.plan, billingStatus: "not_connected",
    maxUniverses: (process.env.ECHO_BETA_ACCESS_MODE === "three_seats" || entitlements.plan === "creator" ? 5 : 1) + entitlements.addonUniverses,
    maxCharacters: (process.env.ECHO_BETA_ACCESS_MODE === "three_seats" || entitlements.plan === "creator" ? 25 : 5) + entitlements.addonCharacters,
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
  })));
});

router.put("/creator/universes/:universeId/management", async (req, res): Promise<void> => {
  const input = z.object({
    action: z.enum(["edit", "archive", "restore", "delete"]),
    expectedRevision: z.number().int().positive(),
    name: z.string().trim().min(1).max(60).optional(),
    description: z.string().max(500).optional(),
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

return router;
}
export default createCreatorRouter();
