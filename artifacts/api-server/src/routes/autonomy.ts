import {
  GetAutonomySettingsResponse,
  RunAutonomyDryRunBody,
  SaveUniverseBody,
  UpdateAutonomySettingsBody,
} from "@workspace/api-zod";
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { EngineError } from "../ai-engine/contracts";
import { FreeModelProvider } from "../ai-engine/free-models";
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
const repository = {
  read: readUniverse,
  readControls: readOwnerControls,
  getExecutedHistory: getExecutedActionHistory,
  reserve: reserveDryRun,
  complete: completeDryRun,
};

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

export default router;
