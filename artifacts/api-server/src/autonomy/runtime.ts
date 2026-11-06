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
  return startAutonomyWorker({
    enabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
    tick: async () => {
      const result = await runAutonomyWorkerTick({
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
            });
            if (outcome.status === "failed") logger.warn({ code: outcome.reasonCode }, "Autonomy character failed");
            return outcome;
          } catch (error) {
            logger.warn({ code: error instanceof Error ? error.message.slice(0, 100) : "UNKNOWN" }, "Autonomy character threw");
            throw error;
          }
        },
      });
      if (result.status === "completed") {
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
