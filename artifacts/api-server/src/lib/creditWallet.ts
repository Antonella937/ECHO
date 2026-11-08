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
        [ownerId,kind,amount,`monthly:${month}`,monthEnd(now)]);
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

/** Atomically spend credits from expiring balances first; no negative balances or duplicate charges. */
export async function spendCredits(ownerId: string, kind: Kind, amount: number, operationKey: string) {
  if (!Number.isSafeInteger(amount) || amount < 1 || amount > 10 || !/^[a-zA-Z0-9:_-]{8,160}$/.test(operationKey)) throw new Error("INVALID_CREDIT_SPEND");
  // Ensure monthly entitlements exist before charging.
  await creditWallet(ownerId);
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT owner_id FROM echo_credit_wallets WHERE owner_id=$1 FOR UPDATE", [ownerId]);
    const prior = await client.query("SELECT 1 FROM echo_credit_ledger WHERE owner_id=$1 AND event_key=$2 LIMIT 1", [ownerId,`spend:${operationKey}`]);
    if (prior.rowCount) { await client.query("ROLLBACK"); return { charged: false, duplicate: true }; }
    const grants = await client.query<{id:string;bucket:Bucket;remaining:string;expires_at:Date|null}>(`
      SELECT g.id::text,g.bucket,g.expires_at,
      (g.amount + COALESCE((SELECT SUM(d.amount) FROM echo_credit_ledger d WHERE d.owner_id=g.owner_id AND (d.event_key LIKE 'debit:' || g.id || ':%' OR d.event_key LIKE 'refund:debit:' || g.id || ':%')),0))::text AS remaining
      FROM echo_credit_ledger g WHERE g.owner_id=$1 AND g.kind=$2 AND g.amount>0 AND g.event_key NOT LIKE 'refund:%'
        AND (g.expires_at IS NULL OR g.expires_at>now())
      ORDER BY CASE g.bucket WHEN 'reward' THEN 0 WHEN 'monthly' THEN 1 ELSE 2 END,
        g.expires_at ASC NULLS LAST,g.id ASC`,[ownerId,kind]);
    let remaining = amount;
    const charges: {id:string;bucket:Bucket;amount:number;expires:Date|null}[] = [];
    for (const grant of grants.rows) {
      const available = Math.max(0,Number(grant.remaining));
      const take = Math.min(remaining,available);
      if (take) { charges.push({id:grant.id,bucket:grant.bucket,amount:take,expires:grant.expires_at}); remaining -= take; }
      if (!remaining) break;
    }
    if (remaining) { await client.query("ROLLBACK"); return { charged:false, insufficient:true }; }
    for (const item of charges) {
      await client.query(`INSERT INTO echo_credit_ledger(owner_id,kind,bucket,amount,event_key,expires_at)
        VALUES($1,$2,$3,$4,$5,$6)`,[ownerId,kind,item.bucket,-item.amount,`debit:${item.id}:${operationKey}`,item.expires]);
    }
    await client.query("COMMIT");
    return {charged:true};
  } catch(error) { await client.query("ROLLBACK"); throw error; } finally { client.release(); }
}

/** Idempotent reversal, tied to the original grant and its original expiry. */
export async function refundCredits(ownerId:string, operationKey:string) {
  const client=await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT owner_id FROM echo_credit_wallets WHERE owner_id=$1 FOR UPDATE",[ownerId]);
    const charges=await client.query<{kind:Kind;bucket:Bucket;amount:number;event_key:string;expires_at:Date|null}>(`
      SELECT kind,bucket,amount,event_key,expires_at FROM echo_credit_ledger
      WHERE owner_id=$1 AND event_key LIKE $2 AND amount<0`,[ownerId,`debit:%:${operationKey}`]);
    for(const item of charges.rows) {
      await client.query(`INSERT INTO echo_credit_ledger(owner_id,kind,bucket,amount,event_key,expires_at)
        VALUES($1,$2,$3,$4,$5,$6) ON CONFLICT DO NOTHING`,
        [ownerId,item.kind,item.bucket,-item.amount,`refund:${item.event_key}`,item.expires_at]);
    }
    await client.query("COMMIT");
    return {refunded:charges.rows.length>0};
  } catch(error) {await client.query("ROLLBACK");throw error;} finally {client.release();}
}
