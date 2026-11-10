import { createHash } from "node:crypto";
import { GeminiDmProvider } from "../ai-engine/gemini";
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
import { readUniverse, writeUniverse } from "../lib/universeRepository";
import { SaveUniverseBody } from "@workspace/api-zod";
import { canCharacterViewCloseFriendsStory } from "../lib/storySharePolicy";
import { runGroupAutonomyOnce } from "./group-executor";
import { runCollaborationAutonomyOnce } from "./collaboration-executor";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { dispatchAutonomousVoice, getVoiceOwnerControls, resolveAutonomousVoiceId } from "./voice-adapter";
import { dispatchHyunPrivateSketch } from "./hyun-private-sketch-delivery";


const repository: LiveAutonomyRepository = {
  read: readUniverse,
  readControls: readOwnerControls,
  getExecutedHistory: getExecutedActionHistory,
  reserve: reserveDryRun,
  complete: completeDryRun,
  executeDecision: executeAutonomyDecision,
};

/**
 * Passive story views are separate from AI-generated social actions.
 * A character can see a followed account's story without liking or replying.
 * No model call, notification or social-action quota is consumed.
 */
async function runPassiveStoryViews() {
  const targets = await listLiveOptInTargets();
  const now = Date.now();
  for (const target of targets) {
    if (!target.socialEnabled) continue;
    // Not every character checks stories every half hour.
    if (Math.random() >= 0.38) continue;
    try {
      const snapshot = await readUniverse(target.ownerId, target.universeId);
      if (!snapshot.state) continue;
      const parsed = SaveUniverseBody.shape.state.safeParse(snapshot.state);
      if (!parsed.success) continue;
      const state = parsed.data;
      const character = state.characters.find(c => c.id === target.characterId && !c.archived);
      if (!character) continue;
      const followed = new Set(state.follows[character.id] ?? []);
      const candidates = state.stories.filter(story => {
        const created = new Date(story.createdAt).getTime();
        return created <= now && created > now - 24 * 60 * 60_000 &&
          story.authorId !== character.id && followed.has(story.authorId) &&
          !story.seenBy.includes(character.id) &&
          canCharacterViewCloseFriendsStory(state, story, character.id);
      });
      if (!candidates.length) continue;
      const selected = candidates[Math.floor(Math.random() * candidates.length)];
      const updated = { ...state, stories: state.stories.map(story =>
        story.id === selected.id ? { ...story, seenBy: [...story.seenBy, character.id] } : story,
      ) };
      // CAS: a concurrent user interaction wins rather than being overwritten.
      await writeUniverse(target.ownerId, updated, snapshot.revision, target.universeId);
    } catch (error) {
      logger.warn({ code: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN" }, "Passive story view skipped");
    }
  }
}

/** Event-driven fast path for an incoming DM. Never scans unrelated characters. */
export async function triggerImmediateDmReply(ownerId: string, universeId: string, characterId: string, messageId: string): Promise<void> {
  if (!AUTONOMY_LIVE_EXECUTION_ENABLED) return;
  const preference = await db.execute(sql`SELECT preferences FROM echo_dm_conversation_preferences
    WHERE owner_id = ${ownerId} AND universe_id = ${universeId} AND character_id = ${characterId} LIMIT 1`);
  if ((preference.rows[0]?.preferences as { responseTiming?: string } | undefined)?.responseTiming !== "instant") return;
  const hash = createHash("sha256").update(`incoming-dm:${ownerId}:${universeId}:${characterId}:${messageId}`).digest("hex");
  const idempotencyKey = `${hash.slice(0,8)}-${hash.slice(8,12)}-5${hash.slice(13,16)}-a${hash.slice(17,20)}-${hash.slice(20,32)}`;
  await runAutonomyLiveCycle(ownerId, { universeId, characterId, idempotencyKey }, {
    repository, provider: new MeteredTextProvider(ownerId, "autonomy", new GeminiDmProvider(undefined, fetch, ownerId)),
    liveExecutionEnabled: AUTONOMY_LIVE_EXECUTION_ENABLED, lane: "dm",
    sketchDelivery: dispatchHyunPrivateSketch,
    voiceDelivery: await getVoiceOwnerControls(ownerId).then(controls => controls ? {
      ...controls, dispatch: dispatchAutonomousVoice, resolveVoiceId: resolveAutonomousVoiceId,
    } : undefined).catch(() => undefined),
  });
}

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
          provider: new MeteredTextProvider(ownerId, "autonomy", new GeminiDmProvider(undefined, fetch, ownerId)),
          liveExecutionEnabled: AUTONOMY_LIVE_EXECUTION_ENABLED,
          sketchDelivery: dispatchHyunPrivateSketch,
          now,
          lane: input.lane,
          voiceDelivery: await getVoiceOwnerControls(ownerId).then(controls => controls ? {
            ...controls, dispatch: dispatchAutonomousVoice, resolveVoiceId: resolveAutonomousVoiceId,
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
      if (result.status === "completed" && socialSlot !== lastSocialSlotAttempted) {
        await runPassiveStoryViews().catch(error =>
          logger.warn({ code: error instanceof Error ? error.message.slice(0, 80) : "UNKNOWN" }, "Passive story view scan failed"));
      }
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
