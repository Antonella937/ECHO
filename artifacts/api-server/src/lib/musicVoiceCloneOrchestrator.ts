/** Durable voice cloning lifecycle. No call is made unless server-side spending
 * is enabled AND a prepared job was explicitly confirmed by its owner.
 * Ambiguous provider submissions are never retried automatically.
 */
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { fetchOwnedPrivateVocalSample } from "./musicVoiceSampleStorage";
import { submitMurekaVoiceClone, checkMurekaVoiceClone, fetchMurekaVoiceClone } from "./murekaVoiceClone";

const UUID=/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
function assertJobId(id:string) {if(!UUID.test(id))throw new Error("VOICE_CLONE_JOB_ID_INVALID");}
export async function submitConfirmedVoiceClone(ownerId:string,jobId:string) {
  assertJobId(jobId);
  if(process.env.ECHO_MUSIC_VOICE_CLONE_ENABLED!=="true") throw new Error("VOICE_CLONE_SPENDING_DISABLED");
  const claim=await db.execute(sql`
    UPDATE echo_music_voice_clone_jobs
    SET status='submitting',charge_confirmed=true,updated_at=now()
    WHERE id=${jobId}::uuid AND owner_id=${ownerId}
      AND status='awaiting_confirmation' AND consent_confirmed=true
      AND charge_confirmed=false AND provider_request_id IS NULL
    RETURNING character_id,sample_storage_key
  `);
  const row=claim.rows[0];
  if(!row) throw new Error("VOICE_CLONE_JOB_NOT_CONFIRMABLE");
  // A timeout after the provider receives the request can still incur a charge.
  // Leave the job in submission_uncertain, never blindly resubmit.
  try {
    const sample=await fetchOwnedPrivateVocalSample(ownerId,String(row.character_id),String(row.sample_storage_key));
    const uri=`data:${sample.mimeType};base64,${sample.bytes.toString("base64")}`;
    const requestId=await submitMurekaVoiceClone(uri);
    await db.execute(sql`
      UPDATE echo_music_voice_clone_jobs SET status='processing',
        provider_request_id=${requestId},updated_at=now()
      WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='submitting'
    `);
    return {jobId,status:"processing",providerRequestIdRecorded:true};
  } catch(error) {
    await db.execute(sql`
      UPDATE echo_music_voice_clone_jobs SET status='submission_uncertain',
        error_code='SUBMISSION_REQUIRES_RECONCILIATION',updated_at=now()
      WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='submitting'
    `);
    throw error;
  }
}
export async function syncVoiceCloneJob(ownerId:string,jobId:string) {
  assertJobId(jobId);
  const found=await db.execute(sql`
    SELECT character_id,status,provider_request_id,provider_vocal_id
    FROM echo_music_voice_clone_jobs
    WHERE id=${jobId}::uuid AND owner_id=${ownerId} LIMIT 1
  `);
  const row=found.rows[0];
  if(!row) throw new Error("VOICE_CLONE_JOB_NOT_FOUND");
  if(row.status!=="processing" || typeof row.provider_request_id!=="string")
    return {status:row.status,jobId};
  let vocalId=typeof row.provider_vocal_id==="string"?row.provider_vocal_id:"";
  if(!vocalId) {
    const state=await checkMurekaVoiceClone(row.provider_request_id);
    if(state!=="COMPLETED")return {status:state,jobId};
    vocalId=await fetchMurekaVoiceClone(row.provider_request_id);
    await db.execute(sql`
      UPDATE echo_music_voice_clone_jobs SET provider_vocal_id=${vocalId},updated_at=now()
      WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='processing'
    `);
  }
  // Never overwrite an established identity. A user can explicitly replace
  // it through the existing voice-registration flow.
  const linked=await db.execute(sql`
    INSERT INTO echo_character_singing_voices (owner_id,character_id,mureka_vocal_id)
    VALUES (${ownerId},${String(row.character_id)},${vocalId})
    ON CONFLICT (owner_id,character_id) DO UPDATE
      SET updated_at=now()
      WHERE echo_character_singing_voices.mureka_vocal_id=EXCLUDED.mureka_vocal_id
    RETURNING mureka_vocal_id
  `);
  if(!linked.rows.length) return {status:"VOICE_REPLACEMENT_REQUIRES_CONFIRMATION",jobId,vocalId};
  await db.execute(sql`
    UPDATE echo_music_voice_clone_jobs SET status='completed',completed_at=now(),updated_at=now()
    WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='processing'
  `);
  return {status:"completed",jobId,vocalId};
}
