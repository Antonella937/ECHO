import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { sendKindroidSceneGroupMessage } from "./scene-kindroid-group-send";
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
  try {
    const result=await db.execute(sql`UPDATE echo_scene_kindroid_deliveries
      SET status='sending',attempted_at=now()
      WHERE owner_id=${input.ownerId} AND universe_id=${input.universeId}
        AND scene_id=${input.sceneId} AND event_id=${input.eventId}
        AND kindroid_group_id=${input.groupId} AND status='reserved'
        AND NOT EXISTS (
          SELECT 1 FROM echo_scene_kindroid_deliveries other
          WHERE other.owner_id=${input.ownerId}
            AND other.kindroid_group_id=${input.groupId}
            AND other.status='sending'
        )
        AND NOT EXISTS (
          SELECT 1 FROM echo_scene_kindroid_generations generation
          WHERE generation.owner_id=${input.ownerId}
            AND generation.kindroid_group_id=${input.groupId}
            AND generation.status IN ('generating','uncertain')
        )
      RETURNING delivery_key`);
    return result.rows.length===1;
  } catch (error) {
    // Concurrent claims can both pass NOT EXISTS; the partial unique index
    // resolves that race. SQLSTATE 23505 means this group is already sending.
    if (error && typeof error==="object" && "code" in error && error.code==="23505") return false;
    throw error;
  }
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

/** Prepared but not wired into scene routes until migration and group sync are verified.
 * A failure after beginning a network attempt remains uncertain, never retried.
 */
export async function deliverSceneKindroidEventOnce(
  input:SceneDelivery,message:string,apiKey:string,request:typeof fetch=fetch,
):Promise<"sent"|"already_claimed"|"uncertain">{
  if(!message.trim() || message.length>5000 || !apiKey) {
    throw new Error("SCENE_DELIVERY_INVALID_INPUT");
  }
  // Check for another in-flight group write before reserving this event.
  // The partial unique index remains the final concurrency safeguard.
  const busy=await db.execute(sql`SELECT 1 FROM echo_scene_kindroid_deliveries
    WHERE owner_id=${input.ownerId} AND kindroid_group_id=${input.groupId}
      AND status='sending' LIMIT 1`);
  if(busy.rows.length) return "already_claimed";
  if(!await reserveSceneKindroidDelivery(input)) return "already_claimed";
  if(!await beginSceneKindroidDelivery(input)) {
    // The event has a durable reservation but was never sent. It may be
    // attempted later only after explicit reconciliation; no automatic retry.
    return "already_claimed";
  }
  try {
    await sendKindroidSceneGroupMessage(input.groupId,message,apiKey,request);
  } catch {
    // A remote write may have succeeded despite a failed response.
    // If recording uncertainty fails, surface that DB error for reconciliation.
    const recorded = await finishSceneKindroidDelivery(input,"uncertain");
    if (!recorded) throw new Error("SCENE_DELIVERY_STATE_LOST");
    return "uncertain";
  }
  // Do not report success if the database cannot confirm the sent state.
  // Never resend: the remote write has already succeeded.
  const recorded = await finishSceneKindroidDelivery(input,"sent");
  if (!recorded) throw new Error("SCENE_DELIVERY_STATE_LOST");
  return "sent";
}
