import {
  RunAutonomyDryRunBody,
  SaveUniverseBody,
  type AutonomyDryRunInput,
  type AutonomyDryRunResult,
} from "@workspace/api-zod";
import { EngineError } from "../ai-engine/contracts";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
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
    characters: Map<string, { enabled: boolean; dmEnabled?: boolean; dmFrequency?: "rarely" | "sometimes" | "frequently"; dmMediaPreference?: "text" | "mixed" | "voice"; dmInstructions?: string; maxActionsPerDay: number; minCooldownMinutes: number }>;
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
    /** Separate, disabled-by-default private sketch adapter; never used for other media. */
    sketchDelivery?: (input: {
      ownerId: string; universeId: string; characterId: string;
      recipientId: string; messageId: string; subject: string;
    }) => Promise<"attached" | "skipped">;
    /** Optional production adapter. Never invoked unless owner voice opt-in and budgets are supplied. */
    voiceDelivery?: {
      ownerEnabled: boolean;
      engineReady: boolean;
      maxVoiceMessagesPerDay: number;
      voiceMessagesToday: number;
      remainingCharacters: number;
      preference: "off" | "occasional" | "frequent";
      dispatch(input: { ownerId: string; universeId: string; characterId: string; messageId: string; text: string; voiceId: string }): Promise<void>;
      resolveVoiceId(input: { ownerId: string; universeId: string; characterId: string; basicVoiceId?: string | null }): Promise<string | null>;
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
  if (!controls.liveExecutionEnabled || controls.globalKillSwitchEngaged || !(dependencies.lane === "dm" ? control.dmEnabled : control.enabled)) {
    return { status: "disabled", reasonCode: "OPT_IN_OR_KILL_SWITCH", characterId: character.id, runId: null, model: null };
  }

  // DM replies must not wait for a narrow hourly phase. The policy already
  // enforces per-character cooldown, daily caps and reply deduplication.
  // Infrequent unsolicited outreach remains probabilistic in the DM lane.

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
      minCooldownMinutes: control.minCooldownMinutes, maxActionsPerDay: control.maxActionsPerDay, lane: dependencies.lane, dmFrequency: control.dmFrequency === 'frequently' || control.dmFrequency === 'rarely' ? control.dmFrequency : 'sometimes',
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

    // Scene presence affects unsolicited social outreach only. Incoming DM replies
    // remain governed by existing DM permissions; scenes never override blocks.
    if (dependencies.lane === "dm" && opportunity.situation === "dm" &&
        opportunity.reason !== "A recent incoming direct message is awaiting a reply.") {
      const activeScenes = await db.execute(sql`SELECT scene_id FROM echo_scenes
        WHERE owner_id = ${ownerId} AND universe_id = ${universeId}
          AND status = 'active' AND participant_ids @> ${JSON.stringify([character.id])}::jsonb
          AND COALESCE((SELECT presence FROM echo_scene_presence p
            WHERE p.owner_id = echo_scenes.owner_id AND p.universe_id = echo_scenes.universe_id
              AND p.scene_id = echo_scenes.scene_id AND p.character_id = ${character.id}), 'present') = 'present'
          LIMIT 1`);
      if (activeScenes.rows.length) {
        await dependencies.repository.complete(ownerId, runId, {
          status: "no_action", sourceRevision: snapshot.revision, lastErrorCode: null,
        }, universeId);
        return { status: "no_action", reasonCode: "CHARACTER_PRESENT_IN_ACTIVE_SCENE",
          characterId: character.id, runId, model: null };
      }
    }

    // Fail closed: BOTH AI identities must explicitly allow the other in this universe.
    if (opportunity.situation === "dm" && opportunity.recipientId &&
        state.characters.some(peer => peer.id === opportunity.recipientId && !peer.archived)) {
      let permitted = false;
      try {
        const permissions = await db.execute(sql`SELECT character_id, enabled, allowed_peer_ids
          FROM echo_character_dm_permissions
          WHERE owner_id = ${ownerId} AND universe_id = ${universeId}
            AND character_id IN (${character.id}, ${opportunity.recipientId})`);
        const sender = permissions.rows.find(row => row.character_id === character.id);
        const receiver = permissions.rows.find(row => row.character_id === opportunity.recipientId);
        // The universe's active owner identity is human-controlled, not an AI
        // character. Its incoming messages do not require an AI DM permission
        // record in the reverse direction. The AI sender still must opt in.
        // currentCharacterId is the account currently being viewed/managed and
        // may be Mar, Noah, etc. It is NOT the owner's protected identity.
        // The protected primary identity has the stable id "nela" in ECHO.
        const recipientIsOwnerIdentity = opportunity.recipientId === "nela" &&
          state.characters.some(peer => peer.id === "nela" && !peer.archived);
        // The owner's manually controlled identity is not an autonomous peer.
        // DM opt-in authorizes replies to the owner without a separate AI-to-AI
        // allowlist entry. AI-to-AI conversations still require mutual opt-in.
        permitted = sender?.enabled === true &&
          (recipientIsOwnerIdentity || (
            Array.isArray(sender.allowed_peer_ids) && sender.allowed_peer_ids.includes(opportunity.recipientId) &&
            receiver?.enabled === true &&
            Array.isArray(receiver.allowed_peer_ids) && receiver.allowed_peer_ids.includes(character.id)
          ));
      } catch { permitted = false; }
      if (!permitted) {
        await dependencies.repository.complete(ownerId, runId, {
          status: "no_action", sourceRevision: snapshot.revision, lastErrorCode: null,
        }, universeId);
        return { status: "no_action", reasonCode: "CHARACTER_DM_REQUIRES_MUTUAL_PERMISSION", characterId: character.id, runId, model: null };
      }
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
    if (preview.decision.action === "none" && !(opportunity.situation === "story_reaction" && opportunity.storyId)) {
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
    // Optional private sketch: only an unsolicited Hyun -> Nela DM, never a reply.
    // The delivery adapter revalidates identity, recipient, message ownership and
    // the persisted image budget before any provider request.
    if (outcome.status === "executed" && opportunity.situation === "dm" &&
        preview.decision.action === "draft" && dependencies.sketchDelivery &&
        ownerId === "user_3LeoBfUicTthDVixNbkPlqXFkdZ" &&
        character.id === "account_mw7bvivjs2rpd" && opportunity.recipientId === "nela" &&
        // Do not attach an unrelated drawing to a random DM. A sketch must fit the conversation.
        [...state.messages].reverse().filter(message =>
          (message.senderId === character.id && message.recipientId === "nela") ||
          (message.senderId === "nela" && message.recipientId === character.id)
        ).slice(0, 8).some(message => /\b(sketch(?:es)?|drawing|draw(?:ing)?|artwork|illustrat(?:ion|e)|pencil|paint(?:ing)?)\b/i.test(message.text)) &&
        (dependencies.random?.() ?? Math.random()) < 0.08) {
      try {
        const fresh = await dependencies.repository.read(ownerId, universeId);
        const parsed = SaveUniverseBody.safeParse({ state: fresh.state, expectedRevision: fresh.revision });
        const outgoing = parsed.success ? [...parsed.data.state.messages].reverse().find(message =>
          message.senderId === character.id && message.recipientId === opportunity.recipientId &&
          message.origin === "autonomy" && message.text === preview.decision.text?.trim() &&
          !message.attachments?.some(a => a.type === "image")) : undefined;
        if (outgoing && opportunity.recipientId) {
          await dependencies.sketchDelivery({
            ownerId, universeId, characterId: character.id,
            recipientId: opportunity.recipientId, messageId: outgoing.id,
            subject: "an unfinished original graphite sketch of urban architecture, shadows and light",
          });
        }
      } catch (error) {
        console.warn("Optional private sketch skipped", {
          reason: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN",
        });
      }
    }
    // Production voice hook: only after the text message has been committed. The
    // adapter is deliberately absent until private TTS, consent and budgets exist.
    // Voice failures must never roll back or duplicate an AI text reply.
    if (outcome.status === "executed" && opportunity.situation === "dm" &&
        preview.decision.action === "draft" && (control.dmMediaPreference === "voice" || control.dmMediaPreference === "mixed") && dependencies.voiceDelivery) {
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
          const voiceId = await delivery.resolveVoiceId({ ownerId, universeId, characterId: character.id,
            basicVoiceId: character.configuration?.voice?.basicVoiceId });
          if (outgoing && voiceId && outgoing.text.length <= 180 && !outgoing.attachments?.some(a => a.type === "audio")) {
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
