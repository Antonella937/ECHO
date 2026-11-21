import { sql } from "drizzle-orm";
import { db } from "@workspace/db";

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
