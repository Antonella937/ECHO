/** ECHO Music job orchestration. All methods are server-only.
 * A paid request may ONLY be sent after verified entitlement and a Neon
 * reservation. This module deliberately does not grant entitlements.
 */
import { randomUUID } from "node:crypto";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import { submitMurekaSong, checkMurekaSong, fetchMurekaSongResult, MUREKA_INSTRUMENTAL_MODEL, MUREKA_SONG_MODEL, type MurekaModel } from "./murekaMusic";
import { ingestGeneratedMusic } from "./musicPrivateStorage";

export type MusicJobMode = "manual" | "autonomous";
export type MusicJobInput = {
  ownerId: string; characterId: string; mode: MusicJobMode; title: string;
  verifiedEntitlement: boolean; prompt: string; lyrics?: string; instrumental: boolean;
};
function validOwner(ownerId: string, characterId: string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(characterId)) {
    throw new Error("MUSIC_IDENTIFIERS_INVALID");
  }
}
function firstValue(result: {rows: Record<string, unknown>[]}, key: string): string {
  return String(result.rows[0]?.[key] ?? "");
}
export async function reserveMusicJob(input: MusicJobInput): Promise<{ jobId: string; status: string }> {
  validOwner(input.ownerId, input.characterId);
  if (!input.verifiedEntitlement) throw new Error("MUSIC_ENTITLEMENT_REQUIRED");
  const jobId = randomUUID();
  const result = await db.execute(sql`
    SELECT echo_music_reserve_monthly(${jobId}::uuid,${input.ownerId},${input.characterId},
      ${input.mode},${input.verifiedEntitlement}) AS result
  `);
  const status = firstValue(result, "result");
  if (status !== "RESERVED") throw new Error(`MUSIC_RESERVATION_${status}`);
  await db.execute(sql`UPDATE echo_music_generation_jobs SET title=${input.title.slice(0,120)}, prompt=${input.prompt.slice(0,5000)}, instrumental=${input.instrumental} WHERE id=${jobId}::uuid AND owner_id=${input.ownerId} AND status='reserved'`);
  return { jobId, status };
}
/** Never retry an ambiguous submission: fal may have accepted and billed it.
 * In that case the job stays reserved for reconciliation, not automatic refund.
 */
export async function submitReservedMusicJob(input: MusicJobInput, jobId: string): Promise<string> {
  validOwner(input.ownerId, input.characterId);
  if (!input.verifiedEntitlement) throw new Error("MUSIC_ENTITLEMENT_REQUIRED");
  const claim = await db.execute(sql`
    UPDATE echo_music_generation_jobs SET status='processing',updated_at=now()
    WHERE id=${jobId}::uuid AND owner_id=${input.ownerId} AND character_id=${input.characterId}
      AND status='reserved' AND provider_request_id IS NULL
    RETURNING id
  `);
  if (!claim.rows.length) throw new Error("MUSIC_JOB_NOT_RESERVED");
  const model = input.instrumental ? MUREKA_INSTRUMENTAL_MODEL : MUREKA_SONG_MODEL;
  const requestId = await submitMurekaSong({
    prompt: input.prompt, ...(input.instrumental ? {} : input.lyrics ? { lyrics: input.lyrics } : {}),
    enable_safety_checker: true,
  }, model);
  await db.execute(sql`
    UPDATE echo_music_generation_jobs SET provider_request_id=${requestId},updated_at=now()
    WHERE id=${jobId}::uuid AND owner_id=${input.ownerId} AND status='processing'
  `);
  return requestId;
}
/** One step of a poller. Storage is written before finalizing the Neon job.
 * On transient provider/storage errors, keep processing for safe retry.
 * Library publication is a separate owner-authorized action.
 */
export async function pollMusicJob(ownerId: string, jobId: string, model: MurekaModel) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)) throw new Error("MUSIC_OWNER_INVALID");
  if (!/^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i.test(jobId)) throw new Error("MUSIC_JOB_ID_INVALID");
  const found = await db.execute(sql`
    SELECT provider_request_id, status FROM echo_music_generation_jobs
    WHERE id=${jobId}::uuid AND owner_id=${ownerId} LIMIT 1
  `);
  const row = found.rows[0] as {provider_request_id?: string;status?: string}|undefined;
  if (!row) throw new Error("MUSIC_JOB_NOT_FOUND");
  if (row.status !== "processing" || !row.provider_request_id) return { status: row.status };
  // Once the private file is stored, a retry must not depend on fal's
  // temporary result URL still being available.
  const existing = await db.execute(sql`
    SELECT audio_path, duration_seconds, instrumental FROM echo_music_generation_jobs
    WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='processing'
  `);
  const stored = existing.rows[0];
  if (!stored) return { status: "NOT_PROCESSING", jobId };
  const expectedModel = stored.instrumental === true ? MUREKA_INSTRUMENTAL_MODEL : MUREKA_SONG_MODEL;
  if (model !== expectedModel) throw new Error("MUSIC_JOB_MODEL_MISMATCH");
  const previousKey = stored.audio_path;
  let storedKey: string;
  let durationSeconds = typeof stored.duration_seconds === "number" ? stored.duration_seconds : 0;
  if (typeof previousKey === "string" && previousKey.startsWith("generated/")) {
    storedKey = previousKey;
  } else {
    const state = await checkMurekaSong(row.provider_request_id, model);
    if (state !== "COMPLETED") return { status: state };
    const result = await fetchMurekaSongResult(row.provider_request_id, model);
    storedKey = (await ingestGeneratedMusic(result.audioUrl, ownerId, jobId)).storageKey;
    durationSeconds = result.durationSeconds ?? 0;
  }
  // Persist storage before DB finalization so a transient database failure can
  // be recovered without re-downloading/re-uploading on the next poll.
  await db.execute(sql`
    UPDATE echo_music_generation_jobs SET audio_path=${storedKey},duration_seconds=${durationSeconds},updated_at=now()
    WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='processing'
  `);
  // One transaction: save a private library record and mark the job completed.
  // Never publish the track automatically.
  const completed = await db.transaction(async tx => {
    const locked = await tx.execute(sql`
      SELECT id, character_id, title, prompt, audio_path, status
      FROM echo_music_generation_jobs
      WHERE id=${jobId}::uuid AND owner_id=${ownerId} FOR UPDATE
    `);
    const job = locked.rows[0] as Record<string, unknown> | undefined;
    if (!job || job.status !== "processing" || job.audio_path !== storedKey) return false;
    await tx.execute(sql`
      INSERT INTO echo_music_library
        (owner_id,id,character_id,title,prompt,duration_seconds,status,audio_path)
      VALUES (${ownerId},${jobId},${String(job.character_id)},
        ${String(job.title || "Generated song")},${String(job.prompt || "")},
        ${durationSeconds},'saved_audio',${storedKey})
      ON CONFLICT (owner_id,id) DO NOTHING
    `);
    await tx.execute(sql`
      UPDATE echo_music_generation_jobs
      SET status='completed', completed_at=now(), updated_at=now(),
        duration_seconds=${durationSeconds}
      WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='processing'
    `);
    return true;
  });
  return { status: completed ? "COMPLETED" : "NOT_PROCESSING", jobId };
}
