import { pool } from "@workspace/db";
import { ECHO_CREDIT_POLICY, resolveEchoPlan } from "./entitlements";

type Kind = "photo" | "voice";
type Bucket = "monthly" | "reward" | "purchased";
const utcDay = (now: Date) => now.toISOString().slice(0, 10);
const utcMonth = (now: Date) => now.toISOString().slice(0, 7);
const monthEnd = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));
const utcTomorrow = (now: Date) => new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate() + 1));
const dailyCaps = ECHO_CREDIT_POLICY.monthlyRewardCaps;

export async function creditWallet(ownerId: string, claim = false) {
  const plan = await resolveEchoPlan(ownerId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("INSERT INTO echo_credit_wallets(owner_id) VALUES($1) ON CONFLICT DO NOTHING", [ownerId]);
    await client.query("SELECT owner_id FROM echo_credit_wallets WHERE owner_id=$1 FOR UPDATE", [ownerId]);
    const now = new Date();
    const month = utcMonth(now);
    const grants = ECHO_CREDIT_POLICY.monthlyPlans[plan];
    for (const [kind, amount] of [["photo", grants.photoCredits], ["voice", grants.voiceCredits]] as const) {
      if (!amount) continue;
      await client.query(`INSERT INTO echo_credit_ledger(owner_id,kind,bucket,amount,event_key,expires_at)
        VALUES($1,$2,'monthly',$3,$4,$5) ON CONFLICT DO NOTHING`,
        [ownerId,kind,amount,`monthly:${month}:${plan}`,monthEnd(now)]);
    }
    const today = utcDay(now);
    let claimed = false;
    if (claim) {
      const previous = await client.query<{streak:number}>(
        "SELECT streak FROM echo_daily_reward_claims WHERE owner_id=$1 AND claim_date=$2::date - interval '1 day'",
        [ownerId,today]);
      const streak = previous.rows.length ? (previous.rows[0].streak % 7) + 1 : 1;
      const cap = dailyCaps[plan];
      const used = await client.query<{photo:string;voice:string}>(`SELECT
        COALESCE(SUM(photo_credits),0)::text AS photo, COALESCE(SUM(voice_credits),0)::text AS voice
        FROM echo_daily_reward_claims WHERE owner_id=$1 AND claim_date >= $2::date AND claim_date < $3::date`,
        [ownerId,month+"-01",monthEnd(now).toISOString().slice(0,10)]);
      const photoRemaining = Math.max(0,cap.photo - Number(used.rows[0].photo));
      const voiceRemaining = Math.max(0,cap.voice - Number(used.rows[0].voice));
      // Deterministic tiered rewards; no hidden random odds or user-supplied amounts.
      const proposedPhoto = plan === "free" ? 1 : plan === "plus" ? (streak === 7 ? 2 : 1) : (streak === 7 ? 3 : 1);
      const photo = Math.min(proposedPhoto,photoRemaining);
      const voice = plan === "premium" && streak === 7 ? Math.min(1,voiceRemaining) : 0;
      const inserted = await client.query(`INSERT INTO echo_daily_reward_claims(owner_id,claim_date,streak,photo_credits,voice_credits)
        VALUES($1,$2,$3,$4,$5) ON CONFLICT DO NOTHING RETURNING claim_date`,
        [ownerId,today,streak,photo,voice]);
      claimed = inserted.rowCount === 1;
      if (claimed) for (const [kind,amount] of [["photo",photo],["voice",voice]] as const) {
        if (!amount) continue;
        await client.query(`INSERT INTO echo_credit_ledger(owner_id,kind,bucket,amount,event_key,expires_at)
          VALUES($1,$2,'reward',$3,$4,$5) ON CONFLICT DO NOTHING`,
          [ownerId,kind,amount,`daily:${today}`,new Date(now.getTime()+30*86400000)]);
      }
    }
    const totals = await client.query<{kind:Kind;bucket:Bucket;balance:string}>(`SELECT kind,bucket,COALESCE(SUM(amount),0)::text AS balance FROM echo_credit_ledger
      WHERE owner_id=$1 AND (expires_at IS NULL OR expires_at > now())
      GROUP BY kind,bucket`,[ownerId]);
    const balances = {photo:{monthly:0,reward:0,purchased:0},voice:{monthly:0,reward:0,purchased:0}};
    for (const item of totals.rows) balances[item.kind][item.bucket] = Math.max(0,Number(item.balance));
    const history = await client.query(`SELECT kind,bucket,amount,event_key,created_at,expires_at
      FROM echo_credit_ledger WHERE owner_id=$1 ORDER BY id DESC LIMIT 30`,[ownerId]);
    const reward = await client.query<{streak:number;photo_credits:number;voice_credits:number}>(`SELECT streak,photo_credits,voice_credits FROM echo_daily_reward_claims
      WHERE owner_id=$1 AND claim_date=$2`,[ownerId,today]);
    await client.query("COMMIT");
    return {plan,balances,history:history.rows,dailyReward:{
      available:reward.rows.length===0,claimedToday:reward.rows.length>0,claimedNow:claimed,
      streak:reward.rows[0]?.streak ?? 0,photoCredits:reward.rows[0]?.photo_credits ?? 0,
      voiceCredits:reward.rows[0]?.voice_credits ?? 0,
      nextResetAt:utcTomorrow(now).toISOString(),
    },walletEnabled:true,checkoutEnabled:false};
  } catch (error) { await client.query("ROLLBACK"); throw error; }
  finally { client.release(); }
}
