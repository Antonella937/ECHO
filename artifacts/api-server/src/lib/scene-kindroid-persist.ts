import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { createHash } from "node:crypto";
import type { SceneGenerationClaim } from "./scene-kindroid-generation";

/** Persist a Kin group response only in the ECHO scene event table.
 * Deterministic event IDs prevent a recovered Kindroid reply from appearing twice.
 */
export async function persistKindroidSceneReply(
  input:SceneGenerationClaim,text:string,
):Promise<string>{
  if(typeof text!=="string" || !text.trim() || text.length>5000)
    throw new Error("KINDROID_SCENE_REPLY_INVALID");
  const eventId="kindroid_scene_"+createHash("sha256")
    .update(JSON.stringify([input.ownerId,input.universeId,input.sceneId,
      input.sourceEventId,input.characterId,input.groupId])).digest("hex");
  const result=await db.execute(sql`INSERT INTO echo_scene_events
    (owner_id,universe_id,scene_id,event_id,actor_id,visibility,audience_ids,text,source_event_id)
    VALUES (${input.ownerId},${input.universeId},${input.sceneId},${eventId},
      ${input.characterId},'participants','[]'::jsonb,${text.trim()},${input.sourceEventId})
    ON CONFLICT DO NOTHING RETURNING event_id`);
  if(result.rows.length===1)return eventId;
  const existing=await db.execute(sql`SELECT text,actor_id,source_event_id FROM echo_scene_events
    WHERE owner_id=${input.ownerId} AND universe_id=${input.universeId}
      AND scene_id=${input.sceneId} AND event_id=${eventId} LIMIT 1`);
  const row=existing.rows[0];
  if(row?.text===text.trim() && row.actor_id===input.characterId &&
    row.source_event_id===input.sourceEventId)return eventId;
  throw new Error("KINDROID_SCENE_REPLY_CONFLICT");
}
