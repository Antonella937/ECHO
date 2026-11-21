import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

export type SceneGroupLease={
  ownerId:string;groupId:string;sceneId:string;operationId:string;
  kind:"send"|"generate";
};

/** Acquire one durable group lease for either a human send or Kin generation.
 * No automatic lease expiry: an interrupted remote write may have succeeded.
 */
export async function acquireSceneGroupLease(input:SceneGroupLease):Promise<boolean>{
  if(!input.ownerId || !input.sceneId || !input.operationId ||
    !/^[A-Za-z0-9_-]{8,160}$/.test(input.groupId))return false;
  const result=await db.execute(sql`INSERT INTO echo_scene_kindroid_group_leases
    (owner_id,kindroid_group_id,operation_kind,scene_id,operation_id,status)
    VALUES (${input.ownerId},${input.groupId},${input.kind},
      ${input.sceneId},${input.operationId},'active')
    ON CONFLICT DO NOTHING RETURNING operation_id`);
  return result.rows.length===1;
}

/** Mark an unresolved external write without releasing the group's lease. */
export async function markSceneGroupLeaseUncertain(input:SceneGroupLease):Promise<boolean>{
  const result=await db.execute(sql`UPDATE echo_scene_kindroid_group_leases
    SET status='uncertain'
    WHERE owner_id=${input.ownerId} AND kindroid_group_id=${input.groupId}
      AND scene_id=${input.sceneId} AND operation_id=${input.operationId}
      AND operation_kind=${input.kind} AND status='active'
    RETURNING operation_id`);
  return result.rows.length===1;
}

/** Release only after a confirmed result, never after an uncertain write. */
export async function releaseSceneGroupLease(input:SceneGroupLease):Promise<boolean>{
  const result=await db.execute(sql`DELETE FROM echo_scene_kindroid_group_leases
    WHERE owner_id=${input.ownerId} AND kindroid_group_id=${input.groupId}
      AND scene_id=${input.sceneId} AND operation_id=${input.operationId}
      AND operation_kind=${input.kind} AND status='active'
    RETURNING operation_id`);
  return result.rows.length===1;
}
