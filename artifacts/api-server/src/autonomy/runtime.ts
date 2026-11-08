import { FreeModelProvider } from "../ai-engine/free-models";
import { MeteredTextProvider } from "../lib/metered-ai";
import { executeAutonomyDecision } from "./executor";
import { AUTONOMY_LIVE_EXECUTION_ENABLED } from "./constants";
import {
  claimAutonomyWorkerLease,
  completeDryRun,
  getExecutedActionHistory,
  listLiveOptInTargets,
  readOwnerControls,
  releaseAutonomyWorkerLease,
  reserveDryRun,
} from "./repository";
import { runAutonomyLiveCycle, type LiveAutonomyRepository } from "./service";
import { logger } from "../lib/logger";
import { runAutonomyWorkerTick, startAutonomyWorker } from "./worker";
import { readUniverse } from "../lib/universeRepository";
import { runGroupAutonomyOnce } from "./group-executor";
import { runCollaborationAutonomyOnce } from "./collaboration-executor";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { dispatchAutonomousVoice, getVoiceOwnerControls } from "./voice-adapter";

const provider = new FreeModelProvider();
const repository: LiveAutonomyRepository = {
  read: readUniverse,
  readControls: readOwnerControls,
  getExecutedHistory: getExecutedActionHistory,
  reserve: reserveDryRun,
  complete: completeDryRun,
  executeDecision: executeAutonomyDecision,
};

export function startAutonomyBackgroundWorker() {
  let lastSocialSlotAttempted = -1;
  let lastGroupSlotAttempted = -1;
  let lastCollaborationSlotAttempted = -1;
  return startAutonomyWorker({
    enabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
    tick: async () => {
      const socialSlot = Math.floor(Date.now() / (30 * 60_000));
      const result = await runAutonomyWorkerTick({
        socialTickDue: socialSlot !== lastSocialSlotAttempted,
        enabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
        repository: {
          listLiveOptInTargets,
          claimWorkerLease: claimAutonomyWorkerLease,
          releaseWorkerLease: releaseAutonomyWorkerLease,
        },
        processCharacter: async (ownerId, input, now) => {
          try {
            const outcome = await runAutonomyLiveCycle(ownerId, { universeId: input.universeId, characterId: input.characterId, idempotencyKey: input.idempotencyKey }, {
          repository,
          provider: new MeteredTextProvider(ownerId, "autonomy", provider),
          liveExecutionEnabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
          now,
          lane: input.lane,
          voiceDelivery: await getVoiceOwnerControls(ownerId).then(controls => controls ? {
            ...controls, dispatch: dispatchAutonomousVoice,
          } : undefined).catch(() => undefined),
            });
            if (outcome.status === "no_action" || outcome.status === "rate_limited" || outcome.status === "disabled") {
              logger.info({ lane: input.lane ?? "social", status: outcome.status, reasonCode: outcome.reasonCode }, "Autonomy character skipped");
            }
            if (outcome.status === "failed") logger.warn({ code: outcome.reasonCode }, "Autonomy character failed");
            return outcome;
          } catch (error) {
            logger.warn({ code: error instanceof Error ? error.message.slice(0, 100) : "UNKNOWN" }, "Autonomy character threw");
            throw error;
          }
        },
      });
      if (result.status === "completed" && socialSlot !== lastGroupSlotAttempted) {
        lastGroupSlotAttempted = socialSlot;
        try {
          // One group at most per tick. Avoid fan-out and unexpected provider usage.
          const groups = await db.execute(sql`SELECT owner_id, universe_id, id
            FROM echo_group_conversations
            WHERE autonomy_enabled = true
              AND (autonomy_claim_until IS NULL OR autonomy_claim_until < now())
              AND (last_autonomy_at IS NULL OR last_autonomy_at < now() - autonomy_interval_minutes * interval '1 minute')
            ORDER BY updated_at ASC LIMIT 1`);
          const group = groups.rows[0];
          if (group) {
            const outcome = await runGroupAutonomyOnce(String(group.owner_id), String(group.universe_id), String(group.id));
            logger.info({ status: outcome.status, reason: "reason" in outcome ? outcome.reason : undefined }, "Group autonomy tick");
          }
        } catch (error) {
          logger.warn({ code: error instanceof Error ? error.message.slice(0, 100) : "UNKNOWN" }, "Group autonomy tick failed");
        }
      }
      if (result.status === "completed" && socialSlot !== lastCollaborationSlotAttempted) {
        lastCollaborationSlotAttempted = socialSlot;
        try {
          const targets = await listLiveOptInTargets();
          const unique = [...new Map(targets.filter(t => t.socialEnabled)
            .map(t => [`${t.ownerId}:${t.universeId}`, t])).values()];
          // Limit AI usage: at most one collaboration decision per global tick.
          for (const target of unique) {
            const outcome = await runCollaborationAutonomyOnce(target.ownerId, target.universeId);
            if (outcome.status === "executed") {
              logger.info({ accepted: outcome.accepted }, "Collaboration autonomy decision completed");
              break;
            }
          }
        } catch (error) {
          logger.warn({ code: error instanceof Error ? error.message.slice(0, 100) : "UNKNOWN" }, "Collaboration autonomy tick failed");
        }
      }
      if (result.status === "completed") {
        lastSocialSlotAttempted = socialSlot;
        logger.info({
          evaluated: result.evaluated,
          executed: result.executed,
          noAction: result.noAction,
          failed: result.failed,
        }, "Autonomy worker tick completed");
      }
      return result;
    },
    onError: (code) => logger.warn({ code }, "Autonomy worker tick failed"),
  });
}
