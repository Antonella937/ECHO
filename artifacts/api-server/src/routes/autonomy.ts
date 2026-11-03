import {
  GetAutonomySettingsResponse,
  RunAutonomyDryRunBody,
  SaveUniverseBody,
  UpdateAutonomySettingsBody,
  type CharacterDecisionInput,
} from "@workspace/api-zod";
import { clerkClient } from "@clerk/express";
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { EngineError } from "../ai-engine/contracts";
import { FreeModelProvider } from "../ai-engine/free-models";
import { previewForOwner } from "../ai-engine/service";
import { AUTONOMY_LIVE_EXECUTION_ENABLED, DEFAULT_CHARACTER_CONTROL } from "../autonomy/constants";
import {
  getExecutedActionHistory,
  readOwnerControls,
  reserveDryRun,
  updateCharacterControl,
  updateOwnerKillSwitch,
  completeDryRun,
} from "../autonomy/repository";
import { runAutonomyDryRun } from "../autonomy/service";

const router: IRouter = Router();
const provider = new FreeModelProvider();
const ownerGates = new Map<string, number>();
const testPreviewOwnersUsed = new Map<string, number>();
const repository = {
  read: readUniverse,
  readControls: readOwnerControls,
  getExecutedHistory: getExecutedActionHistory,
  reserve: reserveDryRun,
  complete: completeDryRun,
};
const testPreviewRouteEnabled =
  process.env.NODE_ENV !== "production" &&
  process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_") === true &&
  process.env.CLERK_SECRET_KEY?.startsWith("sk_test_") === true &&
  (!process.env.REPLIT_DEV_DOMAIN || process.env.REPLIT_DEV_DOMAIN.endsWith(".replit.dev"));
const testPreviewSituations = new Set(["like_post", "like_comment", "story_reaction", "dm_reaction"]);

function safeProviderAttempts(error: unknown) {
  const attempts = (error as { attempts?: unknown } | null)?.attempts;
  if (!Array.isArray(attempts)) return [];
  return attempts.slice(0, 8).map((attempt) => {
    const value = attempt as { model?: unknown; outcome?: unknown; code?: unknown; usage?: unknown };
    const usage = value.usage as { promptTokens?: unknown; completionTokens?: unknown; cost?: unknown } | undefined;
    return {
      model: typeof value.model === "string" ? value.model : "unknown",
      outcome: typeof value.outcome === "string" ? value.outcome : "failure",
      code: typeof value.code === "string" ? value.code : null,
      usage: {
        promptTokens: typeof usage?.promptTokens === "number" ? usage.promptTokens : null,
        completionTokens: typeof usage?.completionTokens === "number" ? usage.completionTokens : null,
        cost: typeof usage?.cost === "number" ? usage.cost : null,
      },
    };
  });
}

async function ownerSettings(ownerId: string) {
  const snapshot = await readUniverse(ownerId);
  if (!snapshot.state) throw new EngineError("UNIVERSE_NOT_FOUND", 404);
  const parsed = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!parsed.success) throw new EngineError("INVALID_STORED_UNIVERSE", 422);
  const controls = await readOwnerControls(ownerId);
  return GetAutonomySettingsResponse.parse({
    globalKillSwitchEngaged: controls.globalKillSwitchEngaged,
    liveExecutionEnabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
    characters: parsed.data.state.characters.filter((character) => !character.archived).map((character) => {
      const control = controls.characters.get(character.id) ?? DEFAULT_CHARACTER_CONTROL;
      return {
        characterId: character.id,
        displayName: character.name,
        username: character.handle,
        enabled: control.enabled,
        maxActionsPerDay: control.maxActionsPerDay,
        minCooldownMinutes: control.minCooldownMinutes,
      };
    }),
  });
}

router.get("/autonomy/settings", requireAuth, async (req, res): Promise<void> => {
  try {
    res.json(await ownerSettings(req.userId!));
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("AUTONOMY_SETTINGS_FAILED", 500);
    res.status(safe.status).json({ error: safe.code });
  }
});

router.put("/autonomy/settings", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateAutonomySettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_AUTONOMY_SETTINGS" }); return; }
  const ownerId = req.userId!;
  const update = parsed.data;
  try {
    if ("globalKillSwitchEngaged" in update) {
      await updateOwnerKillSwitch(ownerId, update.globalKillSwitchEngaged);
    } else {
      const snapshot = await readUniverse(ownerId);
      if (!snapshot.state) { res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return; }
      const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
      const account = stored.success
        ? stored.data.state.characters.find((character) => character.id === update.characterId)
        : undefined;
      if (!account || (account.archived && update.enabled)) {
        res.status(404).json({ error: "CHARACTER_NOT_FOUND_OR_ARCHIVED" }); return;
      }
      await updateCharacterControl(ownerId, account.id, update.enabled);
    }
    res.json(await ownerSettings(ownerId));
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("AUTONOMY_SETTINGS_UPDATE_FAILED", 500);
    res.status(safe.status).json({ error: safe.code });
  }
});

router.post("/autonomy/dry-run", requireAuth, async (req, res): Promise<void> => {
  const parsed = RunAutonomyDryRunBody.strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_AUTONOMY_DRY_RUN_INPUT" }); return; }
  const ownerId = req.userId!;
  const now = Date.now();
  const retryAt = ownerGates.get(ownerId) ?? 0;
  if (retryAt > now) {
    res.setHeader("Retry-After", String(Math.ceil((retryAt - now) / 1000)));
    res.status(429).json({ error: "AUTONOMY_DRY_RUN_BUSY" }); return;
  }
  ownerGates.set(ownerId, now + 5000);
  try {
    const report = await runAutonomyDryRun(ownerId, parsed.data, { repository, provider });
    res.json(report);
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("AUTONOMY_DRY_RUN_FAILED", 502);
    req.log.warn({ code: safe.code }, "Text autonomy dry run failed");
    if (safe.retryAfterMs) res.setHeader("Retry-After", String(Math.ceil(safe.retryAfterMs / 1000)));
    res.status(safe.status).json({ error: safe.code, socialActionsExecuted: false });
  } finally {
    ownerGates.set(ownerId, Date.now() + 5000);
  }
});

/*
 * Deliberate, non-persisting provider validation for disposable Clerk test users.
 * This endpoint is not registered in production and never calls the live executor.
 */
if (testPreviewRouteEnabled) {
  router.post("/autonomy/test-preview", requireAuth, async (req, res): Promise<void> => {
    const ownerId = req.userId!;
    const body = req.body as Record<string, unknown> | null;
    const allowedKeys = ["characterId", "idempotencyKey", "situation", "targetId"];
    if (!body || typeof body !== "object" ||
      Object.keys(body).sort().join("|") !== allowedKeys.sort().join("|") ||
      typeof body.characterId !== "string" ||
      typeof body.targetId !== "string" ||
      typeof body.idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey) ||
      typeof body.situation !== "string" ||
      !testPreviewSituations.has(body.situation)) {
      res.status(400).json({ mode: "test_preview", executed: false, socialActionsExecuted: false, error: "INVALID_TEST_PREVIEW_INPUT" });
      return;
    }

    try {
      const user = await clerkClient.users.getUser(ownerId);
      const isDisposableTestOwner =
        user.publicMetadata?.echoAutonomyPreviewTest === true &&
        user.emailAddresses.some((email) => /^echo_[^@]+\+clerk_test@example\.com$/i.test(email.emailAddress));
      if (!isDisposableTestOwner) {
        res.status(404).json({ mode: "test_preview", executed: false, socialActionsExecuted: false, error: "TEST_OWNER_NOT_FOUND" });
        return;
      }
    } catch {
      res.status(404).json({ mode: "test_preview", executed: false, socialActionsExecuted: false, error: "TEST_OWNER_NOT_FOUND" });
      return;
    }

    const previousUse = testPreviewOwnersUsed.get(ownerId);
    if (AUTONOMY_LIVE_EXECUTION_ENABLED || (previousUse !== undefined && Date.now() - previousUse < 30 * 60_000)) {
      res.status(409).json({
        mode: "test_preview", executed: false, liveExecutionEnabled: false, socialActionsExecuted: false,
        error: previousUse !== undefined ? "TEST_OWNER_PREVIEW_ALREADY_USED" : "LIVE_EXECUTION_MUST_REMAIN_DISABLED",
      });
      return;
    }

    const controls = await readOwnerControls(ownerId);
    const characterControl = controls.characters.get(body.characterId as string) ?? DEFAULT_CHARACTER_CONTROL;
    if (!controls.globalKillSwitchEngaged || characterControl.enabled) {
      res.status(403).json({
        mode: "test_preview", executed: false, liveExecutionEnabled: false, socialActionsExecuted: false,
        error: "TEST_PREVIEW_REQUIRES_KILL_SWITCH_AND_OPT_IN_OFF",
      });
      return;
    }

    const snapshot = await readUniverse(ownerId);
    if (!snapshot.state) {
      res.status(404).json({ mode: "test_preview", executed: false, liveExecutionEnabled: false, socialActionsExecuted: false, error: "UNIVERSE_NOT_FOUND" });
      return;
    }
    const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
    if (!stored.success) {
      res.status(422).json({ mode: "test_preview", executed: false, liveExecutionEnabled: false, socialActionsExecuted: false, error: "INVALID_STORED_UNIVERSE" });
      return;
    }

    const character = stored.data.state.characters.find((item) => item.id === body.characterId && !item.archived);
    if (!character) {
      res.status(404).json({ mode: "test_preview", executed: false, liveExecutionEnabled: false, socialActionsExecuted: false, error: "CHARACTER_NOT_FOUND" });
      return;
    }
    const situation = body.situation as "like_post" | "like_comment" | "story_reaction" | "dm_reaction";
    const targetId = body.targetId as string;
    const decisionInput: Record<string, string> = { characterId: character.id, situation };
    if (situation === "like_post") decisionInput.postId = targetId;
    if (situation === "like_comment") {
      const comment = stored.data.state.comments.find((item) => item.id === targetId);
      if (!comment) {
        res.status(404).json({ mode: "test_preview", executed: false, liveExecutionEnabled: false, socialActionsExecuted: false, error: "TEST_TARGET_NOT_FOUND" });
        return;
      }
      decisionInput.postId = comment.postId;
      decisionInput.commentId = targetId;
    }
    if (situation === "story_reaction") decisionInput.storyId = targetId;
    if (situation === "dm_reaction") decisionInput.messageId = targetId;

    testPreviewOwnersUsed.set(ownerId, Date.now());
    try {
      const preview = await previewForOwner(ownerId, decisionInput as CharacterDecisionInput, {
        read: readUniverse,
        provider,
      });
      const attempts = preview.attempts;
      const freeOnly = preview.model.endsWith(":free") &&
        preview.provider.toLowerCase().includes("openrouter") &&
        attempts.length > 0 &&
        attempts.every((attempt) => attempt.model.endsWith(":free")) &&
        (preview.usage.cost == null || preview.usage.cost <= 0);
      if (!freeOnly) {
        res.status(502).json({
          mode: "test_preview", executed: false, liveExecutionEnabled: false, socialActionsExecuted: false,
          providerCalled: attempts.length > 0, validatorAccepted: false, error: "FREE_ONLY_PROVIDER_GUARD_FAILED",
          attempts: attempts.map((attempt) => ({
            model: attempt.model, outcome: attempt.outcome, code: attempt.code, usage: attempt.usage,
          })),
        });
        return;
      }
      res.json({
        mode: "test_preview",
        executed: false,
        liveExecutionEnabled: false,
        socialActionsExecuted: false,
        providerCalled: true,
        validatorAccepted: true,
        targetId: preview.targetId,
        preview,
      });
    } catch (error) {
      const safe = error instanceof EngineError ? error : new EngineError("TEST_PREVIEW_FAILED", 502);
      const attempts = safeProviderAttempts(error);
      const validatorCodes = new Set([
        "INVALID_MODEL_JSON", "INVALID_MODEL_DECISION", "UNSAFE_OR_INCONSISTENT_DECISION",
      ]);
      const validatorAccepted = attempts.some((attempt) => validatorCodes.has(attempt.code ?? "")) ? false : null;
      res.status(safe.status).json({
        mode: "test_preview",
        executed: false,
        liveExecutionEnabled: false,
        socialActionsExecuted: false,
        providerCalled: attempts.length > 0,
        validatorAccepted,
        error: safe.code,
        attempts,
      });
    }
  });
}

export default router;
