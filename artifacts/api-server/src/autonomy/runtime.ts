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
        processCharacter: (ownerId, input, now) => runAutonomyLiveCycle(ownerId, input, {
          repository,
          provider: new MeteredTextProvider(ownerId, "autonomy", provider),
          liveExecutionEnabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
          now,
        }),
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
