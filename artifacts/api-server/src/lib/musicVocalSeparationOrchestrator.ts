/** Durable, explicitly confirmed vocal isolation. No automatic retries after
 * an ambiguous paid submission. Provider access disabled unless explicitly enabled.
 */
import {db} from "@workspace/db";
import {sql} from "drizzle-orm";
import {fetchOwnedPrivateVocalSample,storeSeparatedVocalResult} from "./musicVoiceSampleStorage";
import {submitVocalSeparation,vocalSeparationResult} from "./musicVocalSeparation";
const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function validate(id:string){if(!UUID.test(id))throw new Error("VOCAL_SEPARATION_JOB_ID_INVALID");}
export async function submitConfirmedVocalSeparation(ownerId:string,jobId:string){
 validate(jobId);
 if(process.env.ECHO_MUSIC_VOCAL_SEPARATION_ENABLED!=="true")throw new Error("VOCAL_SEPARATION_SPENDING_DISABLED");
 const claim=await db.execute(sql`
   UPDATE echo_music_vocal_separation_jobs SET status='submitting',updated_at=now()
   WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='awaiting_confirmation'
   AND provider_request_id IS NULL RETURNING character_id,sample_storage_key
 `);
 const row=claim.rows[0];if(!row)throw new Error("VOCAL_SEPARATION_NOT_CONFIRMABLE");
 try{
   const sample=await fetchOwnedPrivateVocalSample(ownerId,String(row.character_id),String(row.sample_storage_key));
   const requestId=await submitVocalSeparation(sample.bytes,sample.mimeType);
   await db.execute(sql`
     UPDATE echo_music_vocal_separation_jobs SET status='processing',
       provider_request_id=${requestId},updated_at=now()
     WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='submitting'
   `);
   return {jobId,status:"processing"};
 }catch(error){
   await db.execute(sql`
     UPDATE echo_music_vocal_separation_jobs SET status='submission_uncertain',updated_at=now()
     WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='submitting'
   `);
   throw error;
 }
}
export async function syncVocalSeparation(ownerId:string,jobId:string){
 validate(jobId);
 const found=await db.execute(sql`
   SELECT character_id,status,provider_request_id,isolated_storage_key
   FROM echo_music_vocal_separation_jobs
   WHERE id=${jobId}::uuid AND owner_id=${ownerId} LIMIT 1
 `);
 const row=found.rows[0];if(!row)throw new Error("VOCAL_SEPARATION_JOB_NOT_FOUND");
 if(row.status!=="processing" || typeof row.provider_request_id!=="string")
   return {jobId,status:row.status,isolatedStorageKey:row.isolated_storage_key||null};
 const result=await vocalSeparationResult(row.provider_request_id);
 if(result.status!=="COMPLETED")return {jobId,status:result.status};
 // Store before changing status. If private storage fails, the same result
 // can be ingested on a later poll without another paid provider submission.
 const saved=await storeSeparatedVocalResult(ownerId,String(row.character_id),result.url);
 await db.execute(sql`
   UPDATE echo_music_vocal_separation_jobs
   SET status='completed',isolated_storage_key=${saved.storageKey},
       completed_at=now(),updated_at=now()
   WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='processing'
 `);
 return {jobId,status:"completed",isolatedStorageKey:saved.storageKey};
}
