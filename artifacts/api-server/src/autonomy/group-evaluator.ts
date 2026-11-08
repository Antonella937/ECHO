import { and, eq, sql } from "drizzle-orm";
import { db, echoUniversesTable } from "@workspace/db";
import { readOwnerControls } from "./repository";
import { chooseGroupSpeaker } from "./group-policy";

/** Read-only evaluation. It cannot generate text or mutate a group. */
export async function evaluateGroupAutonomy(ownerId: string, universeId: string, groupId: string, now = new Date()) {
  const controls = await readOwnerControls(ownerId, universeId);
  if (controls.globalKillSwitchEngaged || !controls.liveExecutionEnabled) return { speakerId: null, reason: "OWNER_DISABLED" };
  const [universe] = await db.select({ state: echoUniversesTable.state, archivedAt: echoUniversesTable.archivedAt, deletedAt: echoUniversesTable.deletedAt })
    .from(echoUniversesTable)
    .where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId))).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) return { speakerId: null, reason: "UNIVERSE_UNAVAILABLE" };
  const state = universe.state as { characters?: Array<{ id: string; archived?: boolean; name?: string; configuration?: { routine?: { timezone?: string }; currentState?: { activity?: string } } }> };
  const groups = await db.execute(sql`SELECT participant_ids, autonomy_enabled, autonomy_interval_minutes, last_autonomy_at
    FROM echo_group_conversations WHERE owner_id = ${ownerId} AND universe_id = ${universeId} AND id = ${groupId} LIMIT 1`);
  const group = groups.rows[0];
  if (!group || group.autonomy_enabled !== true) return { speakerId: null, reason: "GROUP_DISABLED" };
  const messages = await db.execute(sql`SELECT sender_id, body, created_at FROM echo_group_messages
    WHERE owner_id = ${ownerId} AND universe_id = ${universeId} AND group_id = ${groupId}
    ORDER BY created_at DESC LIMIT 1`);
  const last = messages.rows[0];
  const participants = Array.isArray(group.participant_ids) ? group.participant_ids.filter((v): v is string => typeof v === "string") : [];
  const candidates = (state.characters ?? []).filter(c => participants.includes(c.id)).map(c => {
    const control = controls.characters.get(c.id);
    return {
      id: c.id, archived: c.archived, enabled: control?.enabled === true, dmEnabled: control?.dmEnabled === true,
      sleeping: /\b(sleep|sleeping|dormir|durmiendo|descansando)\b/i.test(c.configuration?.currentState?.activity ?? ""),
    };
  });
  const speakerId = chooseGroupSpeaker({
    enabled: true, globalKillSwitchEngaged: controls.globalKillSwitchEngaged,
    liveExecutionEnabled: controls.liveExecutionEnabled,
    intervalMinutes: Number(group.autonomy_interval_minutes),
    lastGroupActionAt: group.last_autonomy_at as Date | null,
    participantIds: participants, candidates, now,
    lastSenderId: last?.sender_id as string | undefined,
    lastMessageAt: last?.created_at as Date | undefined,
    lastMessageText: last?.body as string | undefined,
  });
  return { speakerId, reason: speakerId ? "ELIGIBLE" : "NO_ELIGIBLE_SPEAKER" };
}
