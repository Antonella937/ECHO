import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { sendGroupMessagePush } from "./onesignal-push";

/** Notify only the human participant, never spectators, senders or muted groups. */
export async function notifyNewGroupMessage(input: {
  ownerId: string; universeId: string; groupId: string; senderId: string; messageId: string;
  createdAt?: Date;
}): Promise<void> {
  if (input.senderId === "nela") return;
  if (input.createdAt && Math.abs(Date.now() - input.createdAt.getTime()) > 120_000) return;
  const group = await db.execute(sql`SELECT g.name FROM echo_group_conversations g
    LEFT JOIN echo_group_member_preferences p ON p.owner_id=g.owner_id
      AND p.universe_id=g.universe_id AND p.group_id=g.id AND p.actor_id='nela'
    WHERE g.owner_id=${input.ownerId} AND g.universe_id=${input.universeId}
      AND g.id=${input.groupId} AND g.participant_ids ? 'nela'
      AND COALESCE(p.muted,false)=false LIMIT 1`);
  if (!group.rows.length) return;
  const character = await db.execute(sql`SELECT c->>'name' AS name FROM echo_universes u,
    jsonb_array_elements(u.state->'characters') c
    WHERE u.owner_id=${input.ownerId} AND u.universe_id=${input.universeId}
      AND c->>'id'=${input.senderId} LIMIT 1`);
  await sendGroupMessagePush({
    ownerId: input.ownerId, groupId: input.groupId,
    groupName: String(group.rows[0].name ?? "ECHO"),
    senderName: String(character.rows[0]?.name ?? "Alguien"),
    messageId: input.messageId,
  });
}
