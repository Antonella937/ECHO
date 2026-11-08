import { ECHO_AUDIO_POLICY, resolveEchoPlan } from "./entitlements";
import { creditWallet, spendCredits, refundCredits } from "./creditWallet";

/**
 * One authoritative Voice Credit wallet for manual basic and custom speech.
 * The legacy echo_audio_credit_usage table is no longer charged by this adapter.
 * Autonomy uses its own server-side budget and must not call this adapter.
 */
export async function reserveCharacterAudioCredit(args: {
  ownerId: string; characterId: string; requestKey: string;
  engine: "kokoro" | "custom"; requestedSeconds: number;
}): Promise<{allowed:boolean;remaining:number;reason?:string}> {
  if (!args.requestKey || args.requestKey.length > 128 || !args.characterId || args.characterId.length > 128 ||
      !Number.isFinite(args.requestedSeconds) || args.requestedSeconds <= 0 ||
      args.requestedSeconds > ECHO_AUDIO_POLICY.maxGeneratedAudioSeconds)
    return {allowed:false,remaining:0,reason:"INVALID_AUDIO_REQUEST"};
  const plan = await resolveEchoPlan(args.ownerId);
  if (plan === "free") return {allowed:false,remaining:0,reason:"VOICE_REPLIES_REQUIRE_PLUS"};
  if (args.engine === "custom" && plan !== "premium")
    return {allowed:false,remaining:0,reason:"CUSTOM_VOICE_REQUIRES_PREMIUM"};
  const cost = args.engine === "custom" ? 2 : 1;
  const outcome = await spendCredits(args.ownerId,"voice",cost,args.requestKey);
  const wallet = await creditWallet(args.ownerId);
  const remaining = Object.values(wallet.balances.voice).reduce((sum,amount)=>sum+amount,0);
  return outcome.charged || outcome.duplicate
    ? {allowed:true,remaining}
    : {allowed:false,remaining,reason:"MONTHLY_AUDIO_CREDITS_EXHAUSTED"};
}

/** Reverses the original wallet debit once, preserving the grant's expiry. */
export async function refundFailedCharacterAudio(ownerId:string,requestKey:string):Promise<void> {
  await refundCredits(ownerId,requestKey);
}
