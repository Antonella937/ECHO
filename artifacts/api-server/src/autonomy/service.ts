import {
  RunAutonomyDryRunBody,
  SaveUniverseBody,
  type AutonomyDryRunInput,
  type AutonomyDryRunResult,
} from "@workspace/api-zod";
import { EngineError } from "../ai-engine/contracts";
import { previewForOwner } from "../ai-engine/service";
import { visionService } from "../vision/service";
import type { TextProvider } from "../ai-engine/contracts";
import { chooseAutonomyOpportunity, liveEligibility, type ExecutedAutonomyAction } from "./policy";
import {
  AUTONOMY_LIVE_EXECUTION_ENABLED,
  DEFAULT_CHARACTER_CONTROL,
  isAutonomyLiveExecutionEnabled,
  isAutonomyOwnerAuthorized,
} from "./constants";
import type { LiveExecutionOutcome } from "./executor";
import { sendNewOwnerPush } from "../lib/onesignal-push";
import { chooseVoiceDelivery, isExplicitVoiceRequest, type VoiceDecisionInput } from "./voice-policy";

const DAY_MS = 24 * 60 * 60_000;

const activeDmTyping = new Map<string, number>();
const typingKey = (ownerId: string, universeId: string, characterId: string) => `${ownerId}:${universeId}:${characterId}`;
export function isAutonomyDmTyping(ownerId: string, universeId: string, characterId: string): boolean {
  const key = typingKey(ownerId, universeId, characterId);
  const until = activeDmTyping.get(key) ?? 0;
  if (until <= Date.now()) { activeDmTyping.delete(key); return false; }
  return true;
}


export interface AutonomyRepository {
  read(ownerId: string, universeId?: string): Promise<{ state: unknown; revision: number }>;
  readControls(ownerId: string, universeId?: string): Promise<{
    globalKillSwitchEngaged: boolean;
    liveExecutionEnabled: boolean;
    characters: Map<string, { enabled: boolean; maxActionsPerDay: number; minCooldownMinutes: number }>;
  }>;
  getExecutedHistory(ownerId: string, characterId: string, since: Date, universeId?: string): Promise<ExecutedAutonomyAction[]>;
  reserve(ownerId: string, characterId: string, idempotencyKey: string, sourceRevision: number, universeId?: string, lane?: "dm" | "social"): Promise<
    | { kind: "created"; runId: string }
    | { kind: "duplicate"; runId: string; status: string; characterId: string }
    | { kind: "idempotency_conflict"; runId: string; characterId: string }
    | { kind: "rate_limited" }
  >;
  complete(ownerId: string, runId: string, result: {
    status: string;
    action?: string | null;
    situation?: string | null;
    targetId?: string | null;
    sourceRevision?: number;
    contextHash?: string | null;
    model?: string | null;
    lastErrorCode?: string | null;
  }, universeId?: string): Promise<void>;
}

export interface LiveAutonomyRepository extends AutonomyRepository {
  executeDecision(input: {
    ownerId: string;
    universeId: string;
    runId: string;
    characterId: string;
    sourceRevision: number;
    opportunity: ReturnType<typeof chooseAutonomyOpportunity>;
    decision: NonNullable<AutonomyDryRunResult["preview"]>["decision"];
    contextHash?: string | null;
    model?: string | null;
    liveEnabled: boolean;
    now: Date;
  }): Promise<LiveExecutionOutcome>;
}

function result(input: {
  runId: string | null;
  characterId: string;
  status: AutonomyDryRunResult["status"];
  liveEligible: boolean;
  targetId?: string | null;
  reason: string;
  preview: AutonomyDryRunResult["preview"];
  createdAt: Date;
}): AutonomyDryRunResult {
  return {
    mode: "dry_run",
    runId: input.runId,
    characterId: input.characterId,
    status: input.status,
    liveExecutionEnabled: false,
    liveEligible: input.liveEligible,
    socialActionsExecuted: false,
    reason: input.reason.slice(0, 300),
    targetId: input.targetId ?? null,
    preview: input.preview,
    createdAt: input.createdAt,
  };
}

function isAutonomyBudgetProtected(error: unknown): error is EngineError {
  return error instanceof EngineError &&
    (error.code === "AUTONOMY_BUDGET_PROTECTED" || error.code === "AI_MONTHLY_HARD_CEILING");
}

/** Owner-authenticated, explicit dry run. There is deliberately no executor or scheduler. */
export async function runAutonomyDryRun(
  ownerId: string,
  input: AutonomyDryRunInput,
  dependencies: {
    repository: AutonomyRepository;
    provider: TextProvider;
    now?: Date;
    random?: () => number;
  },
): Promise<AutonomyDryRunResult> {
  if (!ownerId) throw new EngineError("AUTHENTICATION_REQUIRED", 401);
  if (!RunAutonomyDryRunBody.strict().safeParse(input).success) throw new EngineError("INVALID_AUTONOMY_DRY_RUN_INPUT", 400);

  const now = dependencies.now ?? new Date();
  const universeId = input.universeId ?? "primary";
  const snapshot = await dependencies.repository.read(ownerId, universeId);
  if (!snapshot.state) throw new EngineError("UNIVERSE_NOT_FOUND", 404);
  const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!stored.success) throw new EngineError("INVALID_STORED_UNIVERSE", 422);
  const state = stored.data.state;
  const character = state.characters.find((item) => item.id === input.characterId && !item.archived);
  if (!character) throw new EngineError("CHARACTER_NOT_FOUND", 404);

  const reservation = await dependencies.repository.reserve(ownerId, character.id, input.idempotencyKey, snapshot.revision, universeId);
  if (reservation.kind === "rate_limited") {
    return result({
      runId: null, characterId: character.id, status: "rate_limited", liveEligible: false,
      reason: "Manual simulations are temporarily rate-limited; no provider call was made.",
      preview: null, createdAt: now,
    });
  }
  if (reservation.kind === "idempotency_conflict") {
    throw new EngineError("IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_CHARACTER", 409);
  }
  if (reservation.kind === "duplicate") {
    if (reservation.characterId !== character.id) {
      throw new EngineError("IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_CHARACTER", 409);
    }
    const inProgress = reservation.status === "running";
    return result({
      runId: reservation.runId, characterId: character.id,
      status: inProgress ? "in_progress" : "duplicate", liveEligible: false,
      reason: inProgress
        ? "This request is already being processed; it was not started twice."
        : "This request was already processed; it was not called again.",
      preview: null, createdAt: now,
    });
  }

  const runId = reservation.runId;
  try {
    const controls = await dependencies.repository.readControls(ownerId, universeId);
    const characterControl = controls.characters.get(character.id) ?? DEFAULT_CHARACTER_CONTROL;
    const history = await dependencies.repository.getExecutedHistory(
      ownerId, character.id, new Date(now.getTime() - 24 * 60 * 60_000),
      universeId,
    );
    const opportunity = chooseAutonomyOpportunity({
      state,
      character,
      history,
      now,
      random: dependencies.random,
      minCooldownMinutes: characterControl.minCooldownMinutes,
      maxActionsPerDay: characterControl.maxActionsPerDay,
    });
    const policyAllowsLive = liveEligibility({
      globalKillSwitchEngaged: controls.globalKillSwitchEngaged,
      characterEnabled: characterControl.enabled,
      opportunity,
    });
    const eligible = AUTONOMY_LIVE_EXECUTION_ENABLED && policyAllowsLive;

    if (!opportunity.situation) {
      const status = opportunity.reasonCode === "COOLDOWN"
        ? "cooldown"
        : opportunity.reasonCode === "DAILY_CAP" ? "rate_limited" : "no_opportunity";
      await dependencies.repository.complete(ownerId, runId, {
        status, sourceRevision: snapshot.revision,
      }, universeId);
      return result({
        runId, characterId: character.id, status, liveEligible: false,
        reason: opportunity.reason, preview: null, createdAt: now,
      });
    }

    const decisionInput = {
      characterId: character.id,
      situation: opportunity.situation,
      universeId,
      ...(opportunity.postId ? { postId: opportunity.postId } : {}),
      ...(opportunity.commentId ? { commentId: opportunity.commentId } : {}),
      ...(opportunity.recipientId ? { recipientId: opportunity.recipientId } : {}),
      ...(opportunity.storyId ? { storyId: opportunity.storyId } : {}),
      ...(opportunity.messageId ? { messageId: opportunity.messageId } : {}),
    };
    const preview = await previewForOwner(ownerId, decisionInput, {
      read: (id) => dependencies.repository.read(id, universeId),
      provider: dependencies.provider,
      vision: (id, state, input) => visionService.loadContext(id, state, input),
    });
    await dependencies.repository.complete(ownerId, runId, {
      status: preview.decision.action === "none" ? "no_action" : "previewed",
      action: preview.decision.action,
      situation: preview.decision.situation,
      targetId: preview.targetId ?? null,
      sourceRevision: preview.sourceRevision,
      contextHash: preview.contextAudit.contextHash,
      model: preview.model,
    }, universeId);

    return result({
      runId,
      characterId: character.id,
      status: "previewed",
      liveEligible: eligible,
      targetId: preview.targetId ?? null,
      reason: controls.globalKillSwitchEngaged
        ? "Preview only; the owner kill switch is engaged and live execution is disabled."
        : !characterControl.enabled
          ? "Preview only; this character has not been explicitly opted in and live execution is disabled."
          : "Preview only; live execution is disabled in this stage.",
      preview,
      createdAt: now,
    });
  } catch (error) {
    if (isAutonomyBudgetProtected(error)) {
      await dependencies.repository.complete(ownerId, runId, {
        status: "rate_limited",
        sourceRevision: snapshot.revision,
        lastErrorCode: error.code,
      }, universeId).catch(() => undefined);
      return result({
        runId, characterId: character.id, status: "rate_limited", liveEligible: false,
        reason: "Autonomía pausada para proteger el presupuesto mensual. No se realizó ninguna acción.",
        preview: null, createdAt: now,
      });
    }
    await dependencies.repository.complete(ownerId, runId, {
      status: "provider_failed",
      sourceRevision: snapshot.revision,
    }, universeId).catch(() => undefined);
    throw error;
  }
}

export async function runAutonomyLiveCycle(
  ownerId: string,
  input: AutonomyDryRunInput,
  dependencies: {
    repository: LiveAutonomyRepository;
    provider: TextProvider;
    liveExecutionEnabled?: boolean;
    now?: Date;
    random?: () => number;
    lane?: "dm" | "social";
    /** Optional production adapter. Never invoked unless owner voice opt-in and budgets are supplied. */
    voiceDelivery?: {
      ownerEnabled: boolean;
      engineReady: boolean;
      maxVoiceMessagesPerDay: number;
      voiceMessagesToday: number;
      remainingCharacters: number;
      preference: "off" | "occasional" | "frequent";
      dispatch(input: { ownerId: string; universeId: string; characterId: string; messageId: string; text: string; voiceId: string }): Promise<void>;
    };
  },
): Promise<{ status: string; reasonCode: string; characterId: string; runId: string | null; model: string | null }> {
  const liveEnabled = dependencies.liveExecutionEnabled ?? isAutonomyLiveExecutionEnabled();
  if (!liveEnabled || !isAutonomyOwnerAuthorized(ownerId)) {
    return { status: "disabled", reasonCode: "LIVE_EXECUTION_DISABLED", characterId: input.characterId, runId: null, model: null };
  }
  if (!ownerId) throw new EngineError("AUTHENTICATION_REQUIRED", 401);
  if (!RunAutonomyDryRunBody.strict().safeParse(input).success) throw new EngineError("INVALID_AUTONOMY_DRY_RUN_INPUT", 400);
  const now = dependencies.now ?? new Date();
  const universeId = input.universeId ?? "primary";
  const snapshot = await dependencies.repository.read(ownerId, universeId);
  if (!snapshot.state) throw new EngineError("UNIVERSE_NOT_FOUND", 404);
  const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!stored.success) throw new EngineError("INVALID_STORED_UNIVERSE", 422);
  const state = stored.data.state;
  const character = state.characters.find((item) => item.id === input.characterId && !item.archived);
  if (!character) throw new EngineError("CHARACTER_NOT_FOUND", 404);

  const controls = await dependencies.repository.readControls(ownerId, universeId);
  const control = controls.characters.get(character.id) ?? DEFAULT_CHARACTER_CONTROL;
  if (!controls.liveExecutionEnabled || controls.globalKillSwitchEngaged || !control.enabled) {
    return { status: "disabled", reasonCode: "OPT_IN_OR_KILL_SWITCH", characterId: character.id, runId: null, model: null };
  }

  const reservation = await dependencies.repository.reserve(ownerId, character.id, input.idempotencyKey, snapshot.revision, universeId, dependencies.lane ?? "social");
  if (reservation.kind === "rate_limited") {
    return { status: "rate_limited", reasonCode: "RUN_RATE_LIMIT", characterId: character.id, runId: null, model: null };
  }
  if (reservation.kind === "idempotency_conflict") {
    throw new EngineError("IDEMPOTENCY_KEY_REUSED_FOR_DIFFERENT_CHARACTER", 409);
  }
  if (reservation.kind === "duplicate") {
    return {
      status: reservation.status === "running" ? "in_progress" : "duplicate",
      reasonCode: reservation.status === "running" ? "RUN_ALREADY_PROCESSING" : "RUN_ALREADY_PROCESSED",
      characterId: character.id, runId: reservation.runId, model: null,
    };
  }

  const runId = reservation.runId;
  try {
    const history = await dependencies.repository.getExecutedHistory(
      ownerId, character.id, new Date(now.getTime() - DAY_MS), universeId,
    );
    const opportunity = chooseAutonomyOpportunity({
      state, character, history, now, random: dependencies.random,
      minCooldownMinutes: control.minCooldownMinutes, maxActionsPerDay: control.maxActionsPerDay, lane: dependencies.lane,
    });
    if (dependencies.lane === "dm" && opportunity.situation !== "dm") {
      await dependencies.repository.complete(ownerId, runId, { status: "no_action", sourceRevision: snapshot.revision, lastErrorCode: null }, universeId);
      return { status: "no_action", reasonCode: "NO_PENDING_DM", characterId: character.id, runId, model: null };
    }
    if (!opportunity.situation) {
      const status = opportunity.reasonCode === "COOLDOWN"
        ? "cooldown" : opportunity.reasonCode === "DAILY_CAP" ? "rate_limited" : "no_action";
      await dependencies.repository.complete(ownerId, runId, {
        status, sourceRevision: snapshot.revision, lastErrorCode: null,
      }, universeId);
      return { status, reasonCode: opportunity.reasonCode, characterId: character.id, runId, model: null };
    }

    const decisionInput = {
      characterId: character.id,
      situation: opportunity.situation,
      universeId,
      ...(opportunity.postId ? { postId: opportunity.postId } : {}),
      ...(opportunity.commentId ? { commentId: opportunity.commentId } : {}),
      ...(opportunity.recipientId ? { recipientId: opportunity.recipientId } : {}),
      ...(opportunity.storyId ? { storyId: opportunity.storyId } : {}),
      ...(opportunity.messageId ? { messageId: opportunity.messageId } : {}),
    };
    const typingId = typingKey(ownerId, universeId, character.id);
    if (opportunity.situation === "dm") activeDmTyping.set(typingId, Date.now() + 120_000);
    let preview;
    try {
      preview = await previewForOwner(ownerId, decisionInput, {
        read: (id) => dependencies.repository.read(id, universeId), provider: dependencies.provider,
        vision: (id, state, input) => visionService.loadContext(id, state, input),
        liveDmReply: dependencies.lane === 'dm' && opportunity.situation === 'dm',
      });
    } finally {
      activeDmTyping.delete(typingId);
    }
    if (preview.decision.action === "none") {
      await dependencies.repository.complete(ownerId, runId, {
        status: "no_action", action: "none", situation: preview.decision.situation,
        targetId: preview.targetId ?? null, sourceRevision: preview.sourceRevision,
        contextHash: preview.contextAudit.contextHash, model: preview.model, lastErrorCode: null,
      }, universeId);
      return {
        status: "no_action", reasonCode: "MODEL_SELECTED_NONE", characterId: character.id,
        runId, model: preview.model,
      };
    }

    const outcome = await dependencies.repository.executeDecision({
      ownerId, runId, characterId: character.id, sourceRevision: preview.sourceRevision,
      universeId,
      opportunity, decision: preview.decision, contextHash: preview.contextAudit.contextHash,
      model: preview.model, liveEnabled, now,
    });
    // Production voice hook: only after the text message has been committed. The
    // adapter is deliberately absent until private TTS, consent and budgets exist.
    // Voice failures must never roll back or duplicate an AI text reply.
    if (outcome.status === "executed" && opportunity.situation === "dm" &&
        preview.decision.action === "draft" && dependencies.voiceDelivery) {
      const delivery = dependencies.voiceDelivery;
      try {
        const fresh = await dependencies.repository.read(ownerId, universeId);
        const parsed = SaveUniverseBody.safeParse({ state: fresh.state, expectedRevision: fresh.revision });
        if (parsed.success) {
          const outgoing = [...parsed.data.state.messages].reverse().find(message =>
            message.senderId === character.id && message.recipientId === opportunity.recipientId &&
            message.origin === "autonomy" && message.text === preview.decision.text?.trim());
          const incoming = [...state.messages].reverse().find(message =>
            message.senderId === opportunity.recipientId && message.recipientId === character.id);
          const voiceId = character.configuration?.voice?.basicVoiceId;
          if (outgoing && voiceId && !outgoing.attachments?.some(a => a.type === "audio")) {
            const policy: VoiceDecisionInput = {
              voiceId, ownerEnabled: delivery.ownerEnabled, engineReady: delivery.engineReady,
              requestedVoice: !!incoming && isExplicitVoiceRequest(incoming.text),
              preference: delivery.preference, voiceMessagesToday: delivery.voiceMessagesToday,
              maxVoiceMessagesPerDay: delivery.maxVoiceMessagesPerDay,
              remainingCharacters: delivery.remainingCharacters, messageLength: outgoing.text.length,
              random: dependencies.random,
            };
            if (chooseVoiceDelivery(policy) === "voice") {
              await delivery.dispatch({ ownerId, universeId, characterId: character.id,
                messageId: outgoing.id, text: outgoing.text, voiceId });
            }
          }
        }
      } catch (error) {
        console.warn("Optional autonomous voice delivery skipped", { reason: error instanceof Error ? error.name : "UNKNOWN" });
      }
    }
    if (outcome.status === "executed" && process.env.ECHO_ONESIGNAL_REST_API_KEY) {
      // Delivery is best-effort, after the universe transaction has committed.
      try {
        const fresh = await dependencies.repository.read(ownerId, universeId);
        const parsed = SaveUniverseBody.safeParse({ state: fresh.state, expectedRevision: fresh.revision });
        if (parsed.success) await sendNewOwnerPush(ownerId, state, parsed.data.state);
      } catch (error) {
        console.warn("OneSignal dispatch failed", { reason: error instanceof Error ? error.name : "UNKNOWN" });
      }
    }
    return {
      status: outcome.status,
      reasonCode: "reasonCode" in outcome ? outcome.reasonCode : "EXECUTED",
      characterId: character.id, runId, model: preview.model,
    };
  } catch (error) {
    const code = error instanceof EngineError
      ? error.code
      : error instanceof Error && /^[A-Z0-9_]{1,80}$/.test(error.message)
        ? error.message : "LIVE_CYCLE_FAILED";
    if (isAutonomyBudgetProtected(error)) {
      await dependencies.repository.complete(ownerId, runId, {
        status: "rate_limited",
        sourceRevision: snapshot.revision,
        lastErrorCode: code,
      }, universeId).catch(() => undefined);
      return { status: "rate_limited", reasonCode: code, characterId: character.id, runId, model: null };
    }
    await dependencies.repository.complete(ownerId, runId, {
      status: error instanceof EngineError ? "provider_failed" : "live_failed",
      sourceRevision: snapshot.revision, lastErrorCode: code,
    }, universeId).catch(() => undefined);
    return { status: "failed", reasonCode: code, characterId: character.id, runId, model: null };
  }
}
