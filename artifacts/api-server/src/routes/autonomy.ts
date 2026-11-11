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
import { visionService } from "../vision/service";
import {
  DEFAULT_CHARACTER_CONTROL,
  isAutonomyLiveExecutionEnabled,
  isAutonomyOwnerAuthorized,
  withIsolatedAutonomyLiveEnabledForTest,
} from "../autonomy/constants";
import {
  getExecutedActionHistory,
  readOwnerControls,
  reserveDryRun,
  updateCharacterControl,
  updateDmPreferences,
  updateOwnerKillSwitch,
  completeDryRun,
} from "../autonomy/repository";
import { runAutonomyDryRun } from "../autonomy/service";
import { executeAutonomyDecision } from "../autonomy/executor";
import type { Opportunity } from "../autonomy/policy";
import { MeteredTextProvider } from "../lib/metered-ai";
import { db, echoAutonomyRunsTable } from "@workspace/db";
import { and, desc, eq, gte } from "drizzle-orm";

const router: IRouter = Router();
const provider = new FreeModelProvider();
const ownerGates = new Map<string, number>();
const testPreviewOwnersUsed = new Map<string, number>();
const testLiveOwnersUsed = new Set<string>();
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

function requestedUniverseId(value: unknown): string {
  if (value === undefined) return "primary";
  if (typeof value !== "string" || !value.trim() || value.length > 120) {
    throw new EngineError("INVALID_UNIVERSE_ID", 400);
  }
  return value;
}

async function ownerSettings(ownerId: string, universeId = "primary") {
  const snapshot = await readUniverse(ownerId, universeId);
  if (!snapshot.state) throw new EngineError("UNIVERSE_NOT_FOUND", 404);
  const parsed = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!parsed.success) throw new EngineError("INVALID_STORED_UNIVERSE", 422);
  const controls = await readOwnerControls(ownerId, universeId);
  return GetAutonomySettingsResponse.parse({
    universeId,
    globalKillSwitchEngaged: controls.globalKillSwitchEngaged,
    liveExecutionEnabled: isAutonomyLiveExecutionEnabled() && isAutonomyOwnerAuthorized(ownerId),
    characters: parsed.data.state.characters.filter((character) => !character.archived).map((character) => {
      const control = controls.characters.get(character.id) ?? DEFAULT_CHARACTER_CONTROL;
      return {
        characterId: character.id,
        displayName: character.name,
        username: character.handle,
        enabled: control.enabled,
        dmEnabled: control.dmEnabled,
        dmFrequency: control.dmFrequency ?? "sometimes",
        dmMediaPreference: control.dmMediaPreference ?? "text",
        dmInstructions: control.dmInstructions ?? "",
        maxActionsPerDay: control.maxActionsPerDay,
        minCooldownMinutes: control.minCooldownMinutes,
      };
    }),
  });
}

// Owner-scoped recent Kindroid DM failure, never exposes provider secrets or other users' runs.
router.get("/autonomy/dm-error", requireAuth, async (req, res): Promise<void> => {
  res.setHeader("Cache-Control", "private, no-store");
  if (req.userId !== "user_3LeoBfUicTthDVixNbkPlqXFkdZ") {
    res.json({ error: null }); return;
  }
  try {
    const universeId = requestedUniverseId(req.query.universeId);
    const characterId = req.query.characterId;
    if (typeof characterId !== "string" || !characterId || characterId.length > 120) {
      res.status(400).json({ error: "INVALID_CHARACTER_ID" }); return;
    }
    const snapshot = await readUniverse(req.userId!, universeId);
    const parsed = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
    if (!parsed.success || !parsed.data.state.characters.some(c => c.id === characterId && !c.archived)) {
      res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return;
    }
    const [run] = await db.select({
      status: echoAutonomyRunsTable.status,
      situation: echoAutonomyRunsTable.situation,
      code: echoAutonomyRunsTable.lastErrorCode,
      createdAt: echoAutonomyRunsTable.createdAt,
    }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, req.userId!),
      eq(echoAutonomyRunsTable.universeId, universeId),
      eq(echoAutonomyRunsTable.characterId, characterId),
      gte(echoAutonomyRunsTable.createdAt, new Date(Date.now() - 15 * 60_000)),
    )).orderBy(desc(echoAutonomyRunsTable.createdAt)).limit(1);
    const allowed = new Set(["KINDROID_TIMEOUT_RETRY_MANUALLY","KINDROID_CONNECTION_RETRY_MANUALLY",
      "KINDROID_REQUEST_FAILED_RETRY_MANUALLY","KINDROID_RATE_LIMITED","KINDROID_GENERATION_FAILED"]);
    res.json({ error: run && (run.status === "provider_failed" || run.status === "live_failed" || run.status === "stale_failed") &&
      run.code && allowed.has(run.code) ? { code: run.code, at: run.createdAt } : null });
  } catch {
    res.status(503).json({ error: "DM_STATUS_UNAVAILABLE" });
  }
});

router.get("/autonomy/settings", requireAuth, async (req, res): Promise<void> => {
  try {
    const universeId = requestedUniverseId(req.query.universeId);
    res.json(await ownerSettings(req.userId!, universeId));
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("AUTONOMY_SETTINGS_FAILED", 500);
    req.log.error({ code: safe.code, cause: error instanceof Error ? error.message : String(error) }, "Autonomy settings GET failed");
    res.status(safe.status).json({ error: safe.code });
  }
});

router.put("/autonomy/settings", requireAuth, async (req, res): Promise<void> => {
  const parsed = UpdateAutonomySettingsBody.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_AUTONOMY_SETTINGS" }); return; }
  const ownerId = req.userId!;
  const update = parsed.data;
  try {
    const universeId = update.universeId ?? "primary";
    const snapshot = await readUniverse(ownerId, universeId);
    if (!snapshot.state) { res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return; }
    if ("globalKillSwitchEngaged" in update) {
      await updateOwnerKillSwitch(ownerId, update.globalKillSwitchEngaged);
    } else {
      const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
      const account = stored.success
        ? stored.data.state.characters.find((character) => character.id === update.characterId)
        : undefined;
      if (!account || (account.archived && ("enabled" in update ? update.enabled : true))) {
        res.status(404).json({ error: "CHARACTER_NOT_FOUND_OR_ARCHIVED" }); return;
      }
      if ("enabled" in update && update.enabled && !isAutonomyOwnerAuthorized(ownerId)) {
        res.status(403).json({ error: "AUTONOMY_OWNER_NOT_AUTHORIZED" }); return;
      }
      if ("dmPreferences" in update) {
        await updateDmPreferences(ownerId, account.id, universeId, update.dmPreferences);
      } else {
        await updateCharacterControl(ownerId, account.id, update.enabled, universeId, update.lane ?? "social");
      }
    }
    res.json(await ownerSettings(ownerId, universeId));
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
    const report = await runAutonomyDryRun(ownerId, parsed.data, {
      repository, provider: new MeteredTextProvider(ownerId, "autonomy", provider),
    });
    res.json(report);
  } catch (error) {
    const safe = error instanceof EngineError ? error : new EngineError("AUTONOMY_DRY_RUN_FAILED", 502);
    req.log.warn({ code: safe.code, status: safe.status, cause: error instanceof Error ? error.message : String(error) }, "Text autonomy dry run failed");
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
    if (isAutonomyLiveExecutionEnabled() || (previousUse !== undefined && Date.now() - previousUse < 30 * 60_000)) {
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
      const preview = await previewForOwner(ownerId, decisionInput as unknown as CharacterDecisionInput, {
        read: readUniverse,
        provider,
        vision: (id, state, input) => visionService.loadContext(id, state, input),
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

  router.post("/autonomy/test-live-one-shot", requireAuth, async (req, res): Promise<void> => {
    const ownerId = req.userId!;
    const body = req.body as Record<string, unknown> | null;
    const allowedKeys = ["characterId", "idempotencyKey", "situation", "targetId"];
    if (!body || typeof body !== "object" ||
      Object.keys(body).sort().join("|") !== allowedKeys.sort().join("|") ||
      body.characterId !== "mar" ||
      body.situation !== "like_comment" ||
      typeof body.targetId !== "string" ||
      typeof body.idempotencyKey !== "string" ||
      !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(body.idempotencyKey)) {
      res.status(400).json({ status: "blocked", error: "INVALID_ONE_SHOT_TEST_INPUT", executed: false, socialActionsExecuted: false });
      return;
    }
    if (testLiveOwnersUsed.has(ownerId)) {
      res.status(409).json({ status: "blocked", error: "TEST_OWNER_LIVE_ATTEMPT_ALREADY_USED", executed: false, socialActionsExecuted: false });
      return;
    }
    try {
      const user = await clerkClient.users.getUser(ownerId);
      if (user.publicMetadata?.echoAutonomyPreviewTest !== true ||
        !user.emailAddresses.some((email) => /^echo_[^@]+\+clerk_test@example\.com$/i.test(email.emailAddress))) {
        res.status(404).json({ status: "blocked", error: "TEST_OWNER_NOT_FOUND", executed: false, socialActionsExecuted: false });
        return;
      }
    } catch {
      res.status(404).json({ status: "blocked", error: "TEST_OWNER_NOT_FOUND", executed: false, socialActionsExecuted: false });
      return;
    }
    if (isAutonomyLiveExecutionEnabled()) {
      res.status(409).json({ status: "blocked", error: "GLOBAL_LIVE_GATE_MUST_START_OFF", executed: false, socialActionsExecuted: false });
      return;
    }

    const controls = await readOwnerControls(ownerId);
    const characterControl = controls.characters.get("mar") ?? DEFAULT_CHARACTER_CONTROL;
    if (!controls.globalKillSwitchEngaged || characterControl.enabled) {
      res.status(403).json({ status: "blocked", error: "TEST_CONTROLS_MUST_START_SAFE", executed: false, socialActionsExecuted: false });
      return;
    }
    const snapshot = await readUniverse(ownerId);
    if (!snapshot.state) {
      res.status(404).json({ status: "blocked", error: "UNIVERSE_NOT_FOUND", executed: false, socialActionsExecuted: false });
      return;
    }
    const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
    if (!stored.success) {
      res.status(422).json({ status: "blocked", error: "INVALID_STORED_UNIVERSE", executed: false, socialActionsExecuted: false });
      return;
    }
    const comment = stored.data.state.comments.find((item) => item.id === body.targetId);
    if (!comment) {
      res.status(404).json({ status: "blocked", error: "TEST_TARGET_NOT_FOUND", executed: false, socialActionsExecuted: false });
      return;
    }

    const idempotencyKey = body.idempotencyKey;
    const testInput = {
      characterId: "mar",
      situation: "like_comment" as const,
      commentId: comment.id,
      postId: comment.postId,
    };
    testLiveOwnersUsed.add(ownerId);
    let preview: Awaited<ReturnType<typeof previewForOwner>>;
    try {
      preview = await previewForOwner(ownerId, testInput, {
        read: readUniverse,
        provider,
        vision: (id, state, input) => visionService.loadContext(id, state, input),
      });
    } catch (error) {
      const safe = error instanceof EngineError ? error : new EngineError("TEST_PREVIEW_FAILED", 502);
      const attempts = safeProviderAttempts(error);
      res.status(safe.status).json({
        status: "blocked", error: safe.code, executed: false, socialActionsExecuted: false,
        providerCalled: attempts.length > 0, validatorAccepted: false, attempts,
      });
      return;
    }
    const freeOnly = preview.provider.toLowerCase().includes("openrouter") &&
      preview.model.endsWith(":free") && preview.attempts.length > 0 &&
      preview.attempts.every((attempt) => attempt.model.endsWith(":free")) &&
      (preview.usage.cost == null || preview.usage.cost <= 0);
    if (!freeOnly) {
      res.status(502).json({
        status: "blocked", error: "FREE_ONLY_PROVIDER_GUARD_FAILED", executed: false, socialActionsExecuted: false,
        providerCalled: preview.attempts.length > 0, validatorAccepted: false,
        attempts: preview.attempts.map((attempt) => ({ model: attempt.model, outcome: attempt.outcome, code: attempt.code })),
      });
      return;
    }
    if (preview.decision.action === "none") {
      res.json({
        status: "no_action", executed: false, socialActionsExecuted: false,
        providerCalled: true, validatorAccepted: true, liveExecutionEnabled: false,
        preview, reservation: null,
      });
      return;
    }
    if (preview.decision.action !== "like" || preview.decision.situation !== "like_comment") {
      res.status(422).json({
        status: "blocked", error: "TEST_ACTION_NOT_ALLOWLISTED", executed: false, socialActionsExecuted: false,
        providerCalled: true, validatorAccepted: true, preview,
      });
      return;
    }

    const firstReservation = await reserveDryRun(ownerId, "mar", idempotencyKey, preview.sourceRevision);
    if (firstReservation.kind !== "created") {
      res.status(409).json({
        status: "blocked", error: "ONE_SHOT_RUN_RESERVATION_FAILED", executed: false, socialActionsExecuted: false,
        firstReservation,
      });
      return;
    }
    const retryWhileRunning = await reserveDryRun(ownerId, "mar", idempotencyKey, preview.sourceRevision);
    if (retryWhileRunning.kind !== "duplicate" ||
      retryWhileRunning.runId !== firstReservation.runId ||
      retryWhileRunning.status !== "running") {
      res.status(409).json({
        status: "blocked", error: "IDEMPOTENCY_RESERVATION_RETRY_FAILED", executed: false, socialActionsExecuted: false,
        firstReservation, retryWhileRunning,
      });
      return;
    }

    let outcome: Awaited<ReturnType<typeof executeAutonomyDecision>> | undefined;
    let after: Awaited<ReturnType<typeof readUniverse>> | undefined;
    let retryAfterExecution: Awaited<ReturnType<typeof reserveDryRun>> | undefined;
    let restoredControls = false;
    try {
      await updateCharacterControl(ownerId, "mar", true);
      await updateOwnerKillSwitch(ownerId, false);
      outcome = await withIsolatedAutonomyLiveEnabledForTest(async () => {
        if (!isAutonomyLiveExecutionEnabled()) throw new EngineError("GLOBAL_LIVE_GATE_DID_NOT_OPEN", 500);
        return executeAutonomyDecision({
          ownerId,
          runId: firstReservation.runId,
          characterId: "mar",
          sourceRevision: preview.sourceRevision,
          opportunity: {
            situation: "like_comment",
            postId: comment.postId,
            commentId: comment.id,
            reasonCode: "OPPORTUNITY_SELECTED",
            reason: "isolated one-shot validation",
            localHour: 12,
            timezone: "UTC",
          } satisfies Opportunity,
          decision: preview.decision,
          contextHash: preview.contextAudit.contextHash,
          model: preview.model,
        });
      });
      after = await readUniverse(ownerId);
      const afterState = SaveUniverseBody.safeParse({
        state: after.state,
        expectedRevision: after.revision,
      });
      if (outcome.status !== "executed" || !afterState.success || after.revision !== snapshot.revision + 1) {
        throw new EngineError("ONE_SHOT_EXECUTION_NOT_VERIFIED", 502);
      }
      const persistedComment = afterState.data.state.comments.find((item) => item.id === comment.id);
      if (!persistedComment || persistedComment.likes.filter((id) => id === "mar").length !== 1 ||
        !persistedComment.likes.includes("mar") ||
        afterState.data.state.notifications.length !== stored.data.state.notifications.length + 1) {
        throw new EngineError("ONE_SHOT_SOCIAL_WRITE_NOT_VERIFIED", 502);
      }
      retryAfterExecution = await reserveDryRun(ownerId, "mar", idempotencyKey, preview.sourceRevision);
      if (retryAfterExecution.kind !== "duplicate" ||
        retryAfterExecution.runId !== firstReservation.runId ||
        retryAfterExecution.status !== "executed") {
        throw new EngineError("IDEMPOTENCY_EXECUTED_RETRY_FAILED", 502);
      }
    } finally {
      await updateCharacterControl(ownerId, "mar", false);
      await updateOwnerKillSwitch(ownerId, true);
      const finalControls = await readOwnerControls(ownerId);
      restoredControls = finalControls.globalKillSwitchEngaged &&
        !(finalControls.characters.get("mar") ?? DEFAULT_CHARACTER_CONTROL).enabled &&
        !isAutonomyLiveExecutionEnabled();
      if (!restoredControls) throw new EngineError("ONE_SHOT_CONTROLS_NOT_RESTORED", 500);
    }

    res.json({
      status: "executed",
      executed: true,
      socialActionsExecuted: true,
      ownerScope: "disposable-clerk-test-owner",
      characterId: "mar",
      providerCalled: true,
      validatorAccepted: true,
      preview,
      run: {
        runId: firstReservation.runId,
        idempotencyKey,
        firstReservation: firstReservation.kind,
        retryWhileRunning: retryWhileRunning.kind,
        retryAfterExecution: retryAfterExecution?.kind ?? null,
        retryRunId: retryAfterExecution?.runId ?? null,
        retryStatus: retryAfterExecution?.status ?? null,
      },
      executor: outcome,
      universe: {
        sourceRevision: snapshot.revision,
        afterRevision: after?.revision,
        targetId: comment.id,
        actorLikeCount: after?.state
          ? (SaveUniverseBody.parse({ state: after.state, expectedRevision: after.revision }).state.comments
            .find((item) => item.id === comment.id)?.likes.filter((id) => id === "mar").length ?? 0)
          : 0,
        exactlyOneAction: true,
      },
      globalLiveFlagDuringExecutor: true,
      globalLiveFlagAfter: isAutonomyLiveExecutionEnabled(),
      controlsRestored: restoredControls,
      schedulerInvoked: false,
    });
  });
}

export default router;
