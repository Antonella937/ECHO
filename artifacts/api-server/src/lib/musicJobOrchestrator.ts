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
  ownerId: string; characterId: string; mode: MusicJobMode;
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
  const found = await db.execute(sql`
    SELECT provider_request_id, status FROM echo_music_generation_jobs
    WHERE id=${jobId}::uuid AND owner_id=${ownerId} LIMIT 1
  `);
  const row = found.rows[0] as {provider_request_id?: string;status?: string}|undefined;
  if (!row) throw new Error("MUSIC_JOB_NOT_FOUND");
  if (row.status !== "processing" || !row.provider_request_id) return { status: row.status };
  const state = await checkMurekaSong(row.provider_request_id, model);
  if (state !== "COMPLETED") return { status: state };
  const result = await fetchMurekaSongResult(row.provider_request_id, model);
  const stored = await ingestGeneratedMusic(result.audioUrl, ownerId, jobId);
  // The existing echo_music_library uses legacy /objects paths; do not insert a
  // Supabase key into that field until its streaming route supports Supabase.
  // Keep the key in the job record until library integration is implemented.
  await db.execute(sql`
    UPDATE echo_music_generation_jobs SET audio_path=${stored.storageKey},updated_at=now()
    WHERE id=${jobId}::uuid AND owner_id=${ownerId} AND status='processing'
  `);
  return { status: "AUDIO_STORED_AWAITING_LIBRARY", storageKey: stored.storageKey };
}
