import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { sceneKindroidDeliveryKey } from "./scene-kindroid-sync-policy";

export type SceneDelivery = {
  ownerId:string; universeId:string; sceneId:string; eventId:string; groupId:string;
};
export type SceneDeliveryState = "reserved"|"sending"|"sent"|"uncertain"|"failed";

/** Atomic claim. Existing claims, including failed/uncertain ones, are never retried. */
export async function reserveSceneKindroidDelivery(input:SceneDelivery):Promise<boolean>{
  const deliveryKey=sceneKindroidDeliveryKey(input.sceneId,input.groupId,input.eventId);
  if(!deliveryKey || !input.ownerId || !input.universeId) return false;
  const result=await db.execute(sql`INSERT INTO echo_scene_kindroid_deliveries
    (owner_id,universe_id,scene_id,event_id,kindroid_group_id,delivery_key,status)
    VALUES (${input.ownerId},${input.universeId},${input.sceneId},${input.eventId},
      ${input.groupId},${deliveryKey},'reserved')
    ON CONFLICT DO NOTHING RETURNING delivery_key`);
  return result.rows.length===1;
}

/** Claim the right to attempt the network write exactly once. */
export async function beginSceneKindroidDelivery(input:SceneDelivery):Promise<boolean>{
  const result=await db.execute(sql`UPDATE echo_scene_kindroid_deliveries
    SET status='sending',attempted_at=now()
    WHERE owner_id=${input.ownerId} AND universe_id=${input.universeId}
      AND scene_id=${input.sceneId} AND event_id=${input.eventId}
      AND kindroid_group_id=${input.groupId} AND status='reserved'
    RETURNING delivery_key`);
  return result.rows.length===1;
}

/** A failed/unknown network write is never automatically eligible for retry. */
export async function finishSceneKindroidDelivery(
  input:SceneDelivery,state:Extract<SceneDeliveryState,"sent"|"uncertain"|"failed">,
):Promise<boolean>{
  const result=await db.execute(sql`UPDATE echo_scene_kindroid_deliveries
    SET status=${state},completed_at=now()
    WHERE owner_id=${input.ownerId} AND universe_id=${input.universeId}
      AND scene_id=${input.sceneId} AND event_id=${input.eventId}
      AND kindroid_group_id=${input.groupId} AND status='sending'
    RETURNING delivery_key`);
  return result.rows.length===1;
}
