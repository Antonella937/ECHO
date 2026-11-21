import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { acquireSceneGroupLease, markSceneGroupLeaseUncertain, releaseSceneGroupLease } from "./scene-kindroid-group-lease";
import { parseKindroidSceneGroupReply } from "./scene-kindroid-reply";

export type SceneGenerationClaim={
  ownerId:string;universeId:string;sceneId:string;sourceEventId:string;
  characterId:string;kinId:string;groupId:string;
};

/** Durable generation claim. Never silently regenerate a previously claimed turn. */
export async function reserveSceneKindroidGeneration(input:SceneGenerationClaim):Promise<boolean>{
  if(!input.ownerId || !input.universeId || !input.sceneId || !input.sourceEventId ||
     !input.characterId || !/^[A-Za-z0-9_-]{8,160}$/.test(input.kinId) ||
     !/^[A-Za-z0-9_-]{8,160}$/.test(input.groupId)) return false;
  const result=await db.execute(sql`INSERT INTO echo_scene_kindroid_generations
    (owner_id,universe_id,scene_id,source_event_id,character_id,kin_id,kindroid_group_id)
    VALUES (${input.ownerId},${input.universeId},${input.sceneId},${input.sourceEventId},
      ${input.characterId},${input.kinId},${input.groupId})
    ON CONFLICT DO NOTHING RETURNING scene_id`);
  return result.rows.length===1;
}

/** A competing generation in the same group must finish before another begins. */
export async function beginSceneKindroidGeneration(input:SceneGenerationClaim):Promise<boolean>{
  try{
    const result=await db.execute(sql`UPDATE echo_scene_kindroid_generations
      SET status='generating',attempted_at=now()
      WHERE owner_id=${input.ownerId} AND universe_id=${input.universeId}
        AND scene_id=${input.sceneId} AND source_event_id=${input.sourceEventId}
        AND character_id=${input.characterId} AND kin_id=${input.kinId}
        AND kindroid_group_id=${input.groupId} AND status='reserved'
        AND NOT EXISTS (SELECT 1 FROM echo_scene_kindroid_generations other
          WHERE other.owner_id=${input.ownerId} AND other.kindroid_group_id=${input.groupId}
            AND other.status='generating')
        AND NOT EXISTS (SELECT 1 FROM echo_scene_kindroid_deliveries outgoing
          WHERE outgoing.owner_id=${input.ownerId}
            AND outgoing.kindroid_group_id=${input.groupId}
            AND outgoing.status IN ('sending','uncertain'))
      RETURNING scene_id`);
    return result.rows.length===1;
  }catch(error){
    if(error && typeof error==="object" && "code" in error && error.code==="23505")return false;
    throw error;
  }
}

/** A generation may have been saved in Kindroid even if ECHO saw a timeout. */
export async function finishSceneKindroidGeneration(
  input:SceneGenerationClaim,status:"generated"|"uncertain",
):Promise<boolean>{
  const result=await db.execute(sql`UPDATE echo_scene_kindroid_generations
    SET status=${status},completed_at=now()
    WHERE owner_id=${input.ownerId} AND universe_id=${input.universeId}
      AND scene_id=${input.sceneId} AND source_event_id=${input.sourceEventId}
      AND character_id=${input.characterId} AND kin_id=${input.kinId}
      AND kindroid_group_id=${input.groupId} AND status='generating'
    RETURNING scene_id`);
  return result.rows.length===1;
}

/** Execute exactly one already-authorized Kin group generation.
 * The caller supplies the group-only transport; private DM providers are forbidden.
 * A timeout is uncertain, so never automatically repeat the remote generation.
 */
export async function generateSceneKindroidOnce(
  input:SceneGenerationClaim,
  generateGroupReply:()=>Promise<string>,
  persistSceneReply:(text:string)=>Promise<void>,
):Promise<{status:"generated";text:string}|{status:"already_claimed"|"uncertain"}>{
  const lease={ownerId:input.ownerId,groupId:input.groupId,sceneId:input.sceneId,
    operationId:input.sourceEventId+":"+input.characterId,kind:"generate" as const};
  if(!await acquireSceneGroupLease(lease))return {status:"already_claimed"};
  let attempted=false;
  try{
    if(!await reserveSceneKindroidGeneration(input)){
      await releaseSceneGroupLease(lease);
      return {status:"already_claimed"};
    }
    if(!await beginSceneKindroidGeneration(input)){
      await releaseSceneGroupLease(lease);
      return {status:"already_claimed"};
    }
    attempted=true;
    let text:string;
    try{
      text=await generateGroupReply();
      if(typeof text!=="string" || !text.trim() || text.length>8000)
        throw new Error("KINDROID_SCENE_INVALID_GROUP_REPLY");
    }catch{
      const recorded=await finishSceneKindroidGeneration(input,"uncertain");
      const blocked=await markSceneGroupLeaseUncertain(lease);
      if(!recorded || !blocked)throw new Error("SCENE_GENERATION_STATE_LOST");
      return {status:"uncertain"};
    }
    // The group response may already be durable in Kindroid. Persist the
    // matching ECHO scene event before declaring this generation complete.
    // A DB failure must remain uncertain, never cause another remote call.
    try{
      await persistSceneReply(text);
    }catch{
      const recorded=await finishSceneKindroidGeneration(input,"uncertain");
      const blocked=await markSceneGroupLeaseUncertain(lease);
      if(!recorded || !blocked)throw new Error("SCENE_GENERATION_RECONCILIATION_REQUIRED");
      return {status:"uncertain"};
    }
    if(!await finishSceneKindroidGeneration(input,"generated")){
      await markSceneGroupLeaseUncertain(lease);
      throw new Error("SCENE_GENERATION_STATE_LOST");
    }
    if(!await releaseSceneGroupLease(lease))throw new Error("SCENE_GENERATION_LEASE_RELEASE_FAILED");
    return {status:"generated",text};
  }catch(error){
    if(attempted)await markSceneGroupLeaseUncertain(lease).catch(()=>false);
    else await releaseSceneGroupLease(lease).catch(()=>false);
    throw error;
  }
}

/** Adapter for the Kindroid group provider's JSON action envelope.
 * Only group-specific provider output is accepted; never route through DM.
 */
export async function generateParsedSceneKindroidOnce(
  input:SceneGenerationClaim,
  completeGroup:()=>Promise<{text:string}>,
  persistSceneReply:(text:string)=>Promise<void>,
):Promise<{status:"generated";text:string}|{status:"already_claimed"|"uncertain"}>{
  return generateSceneKindroidOnce(input,async()=>{
    const completion=await completeGroup();
    const text=parseKindroidSceneGroupReply(completion.text);
    if(!text)throw new Error("KINDROID_SCENE_GROUP_DRAFT_INVALID");
    return text;
  },persistSceneReply);
}
