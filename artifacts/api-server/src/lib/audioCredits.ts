import { pool } from "@workspace/db";
import { ECHO_AUDIO_POLICY, resolveEchoPlan } from "./entitlements";

/**
 * Call BEFORE starting any character-generated audio request.
 * A unique requestKey makes retries idempotent. A transaction-scoped advisory
 * lock serializes quota decisions per owner/month, preventing concurrent overspend.
 * The caller must use a stable request key and must NOT call for incoming user audio.
 */
export async function reserveCharacterAudioCredit(args: {
 ownerId: string; characterId: string; requestKey: string;
 engine: "kokoro" | "custom"; requestedSeconds: number;
}): Promise<{ allowed: boolean; remaining: number; reason?: string }> {
 if (!args.requestKey || args.requestKey.length > 128 || !args.characterId || args.characterId.length > 128 ||
     !Number.isFinite(args.requestedSeconds) || args.requestedSeconds <= 0 ||
     args.requestedSeconds > ECHO_AUDIO_POLICY.maxGeneratedAudioSeconds)
   return { allowed: false, remaining: 0, reason: "INVALID_AUDIO_REQUEST" };
 const plan = await resolveEchoPlan(args.ownerId);
 const limit = ECHO_AUDIO_POLICY.monthlyCredits[plan];
 if (limit === 0) return { allowed: false, remaining: 0, reason: "VOICE_REPLIES_REQUIRE_PLUS" };
 if (args.engine === "custom" && plan !== "premium")
   return { allowed: false, remaining: 0, reason: "CUSTOM_VOICE_REQUIRES_PREMIUM" };
 const monthKey = new Date().toISOString().slice(0, 7);
 const client = await pool.connect();
 try {
  await client.query("BEGIN");
  await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[args.ownerId,monthKey]);
  const previous = await client.query("SELECT 1 FROM echo_audio_credit_usage WHERE owner_id=$1 AND request_key=$2",[args.ownerId,args.requestKey]);
  const usage = await client.query("SELECT COALESCE(SUM(credits),0)::int AS used FROM echo_audio_credit_usage WHERE owner_id=$1 AND month_key=$2",[args.ownerId,monthKey]);
  const used = Number(usage.rows[0]?.used ?? 0);
  if (previous.rowCount) { await client.query("COMMIT"); return { allowed:true,remaining:Math.max(0,limit-used) }; }
  if (used >= limit) { await client.query("ROLLBACK"); return { allowed:false,remaining:0,reason:"MONTHLY_AUDIO_CREDITS_EXHAUSTED" }; }
  await client.query("INSERT INTO echo_audio_credit_usage(owner_id,month_key,request_key,character_id,engine,duration_seconds) VALUES($1,$2,$3,$4,$5,$6)",[args.ownerId,monthKey,args.requestKey,args.characterId,args.engine,args.requestedSeconds]);
  await client.query("COMMIT");
  return { allowed:true,remaining:limit-used-1 };
 } catch(error) { await client.query("ROLLBACK"); throw error; }
 finally { client.release(); }
}

/** Refund a reserved credit if generation failed, not if it completed. */
export async function refundFailedCharacterAudio(ownerId:string,requestKey:string):Promise<void> {
 await pool.query("DELETE FROM echo_audio_credit_usage WHERE owner_id=$1 AND request_key=$2",[ownerId,requestKey]);
}
