import {
  RunAutonomyDryRunBody,
  SaveUniverseBody,
  type AutonomyDryRunInput,
  type AutonomyDryRunResult,
} from "@workspace/api-zod";
import { EngineError } from "../ai-engine/contracts";
import { previewForOwner } from "../ai-engine/service";
import type { TextProvider } from "../ai-engine/contracts";
import { chooseAutonomyOpportunity, liveEligibility, type ExecutedAutonomyAction } from "./policy";
import { AUTONOMY_LIVE_EXECUTION_ENABLED, DEFAULT_CHARACTER_CONTROL } from "./constants";

export interface AutonomyRepository {
  read(ownerId: string): Promise<{ state: unknown; revision: number }>;
  readControls(ownerId: string): Promise<{
    globalKillSwitchEngaged: boolean;
    liveExecutionEnabled: false;
    characters: Map<string, { enabled: boolean; maxActionsPerDay: number; minCooldownMinutes: number }>;
  }>;
  getExecutedHistory(ownerId: string, characterId: string, since: Date): Promise<ExecutedAutonomyAction[]>;
  reserve(ownerId: string, characterId: string, idempotencyKey: string, sourceRevision: number): Promise<
    | { kind: "created"; runId: string }
    | { kind: "duplicate"; runId: string; status: string; characterId: string }
    | { kind: "idempotency_conflict"; runId: string; characterId: string }
    | { kind: "rate_limited" }
  >;
  complete(ownerId: string, runId: string, result: {
    status: string;
    action?: string | null;
    situation?: string | null;
    sourceRevision?: number;
    contextHash?: string | null;
    model?: string | null;
  }): Promise<void>;
}

function result(input: {
  runId: string | null;
  characterId: string;
  status: AutonomyDryRunResult["status"];
  liveEligible: boolean;
  reason: string;
  preview: AutonomyDryRunResult["preview"];
  createdAt: Date;
}): AutonomyDryRunResult {
  return {
    mode: "dry_run",
    runId: input.runId,
    characterId: input.characterId,
    status: input.status,
    liveExecutionEnabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
    liveEligible: input.liveEligible,
    socialActionsExecuted: false,
    reason: input.reason.slice(0, 300),
    preview: input.preview,
    createdAt: input.createdAt,
  };
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
  const snapshot = await dependencies.repository.read(ownerId);
  if (!snapshot.state) throw new EngineError("UNIVERSE_NOT_FOUND", 404);
  const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!stored.success) throw new EngineError("INVALID_STORED_UNIVERSE", 422);
  const state = stored.data.state;
  const character = state.characters.find((item) => item.id === input.characterId && !item.archived);
  if (!character) throw new EngineError("CHARACTER_NOT_FOUND", 404);

  const reservation = await dependencies.repository.reserve(ownerId, character.id, input.idempotencyKey, snapshot.revision);
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
    const controls = await dependencies.repository.readControls(ownerId);
    const characterControl = controls.characters.get(character.id) ?? DEFAULT_CHARACTER_CONTROL;
    const history = await dependencies.repository.getExecutedHistory(
      ownerId, character.id, new Date(now.getTime() - 24 * 60 * 60_000),
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
      });
      return result({
        runId, characterId: character.id, status, liveEligible: false,
        reason: opportunity.reason, preview: null, createdAt: now,
      });
    }

    const decisionInput = {
      characterId: character.id,
      situation: opportunity.situation,
      ...(opportunity.postId ? { postId: opportunity.postId } : {}),
      ...(opportunity.commentId ? { commentId: opportunity.commentId } : {}),
      ...(opportunity.recipientId ? { recipientId: opportunity.recipientId } : {}),
    };
    const preview = await previewForOwner(ownerId, decisionInput, {
      read: dependencies.repository.read,
      provider: dependencies.provider,
    });
    await dependencies.repository.complete(ownerId, runId, {
      status: preview.decision.action === "draft" ? "previewed" : "no_action",
      action: preview.decision.action,
      situation: preview.decision.situation,
      sourceRevision: preview.sourceRevision,
      contextHash: preview.contextAudit.contextHash,
      model: preview.model,
    });

    return result({
      runId,
      characterId: character.id,
      status: "previewed",
      liveEligible: eligible,
      reason: controls.globalKillSwitchEngaged
        ? "Preview only; the owner kill switch is engaged and live execution is disabled."
        : !characterControl.enabled
          ? "Preview only; this character has not been explicitly opted in and live execution is disabled."
          : "Preview only; live execution is disabled in this stage.",
      preview,
      createdAt: now,
    });
  } catch (error) {
    await dependencies.repository.complete(ownerId, runId, {
      status: "provider_failed",
      sourceRevision: snapshot.revision,
    }).catch(() => undefined);
    throw error;
  }
}
