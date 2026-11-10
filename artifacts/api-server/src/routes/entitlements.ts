import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveEchoPlan, ECHO_AUDIO_POLICY, ECHO_VIDEO_POLICY } from "../lib/entitlements";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";
import { pool, db, echoVoiceBudgetsTable, echoVoiceUsageTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

/** Read-only, server-authoritative account capabilities. Never accepts a plan from the client. */
const router: IRouter = Router();
router.get("/account/entitlements", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const ownerId = req.userId!;
    const plan = await resolveEchoPlan(ownerId);
    const lifetimeAccess = lifetimeAccessForOwner(ownerId);
    const [budget] = await db.select().from(echoVoiceBudgetsTable).where(eq(echoVoiceBudgetsTable.ownerId, ownerId)).limit(1);
    const monthKey = new Date().toISOString().slice(0, 7);
    const [monthly] = await db.select({ used: sql<number>`coalesce(sum(${echoVoiceUsageTable.characters}),0)` })
      .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, ownerId), eq(echoVoiceUsageTable.monthKey, monthKey)));
    const [daily] = await db.select({ used: sql<number>`count(*)` })
      .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, ownerId), gte(echoVoiceUsageTable.createdAt, new Date(Date.now() - 86400000))));
    const audioCreditsLimit = ECHO_AUDIO_POLICY.monthlyCredits[plan];
    const audioUsage = await pool.query("SELECT COALESCE(SUM(credits),0)::int AS used FROM echo_audio_credit_usage WHERE owner_id=$1 AND month_key=$2",[ownerId,monthKey]);
    const audioCreditsUsed = Number(audioUsage.rows[0]?.used ?? 0);
    const eligible = plan !== "free";
    const usedCharacters = Number(monthly?.used ?? 0);
    const usedMessagesToday = Number(daily?.used ?? 0);
    const monthlyLimit = eligible ? (budget?.monthlyCharacterLimit ?? 0) : 0;
    const dailyLimit = eligible ? (budget?.maxDailyMessages ?? 0) : 0;
    res.json({ plan, lifetimeAccess, billingExempt: lifetimeAccess !== null, features: { basicVoices: eligible, incomingVoiceMessages: true, characterVoiceReplies: eligible, customVoices: plan === "premium", customVoiceMonthlyAddOnRequired: plan === "premium" && lifetimeAccess === null, music: false, videos: false },
      video: { available: ECHO_VIDEO_POLICY.enabled, checkoutEnabled: ECHO_VIDEO_POLICY.checkoutEnabled, generationEnabled: ECHO_VIDEO_POLICY.generationEnabled, providerConfigured: ECHO_VIDEO_POLICY.providerConfigured, creditExpiry: ECHO_VIDEO_POLICY.creditExpiry, currency: ECHO_VIDEO_POLICY.currency, packs: ECHO_VIDEO_POLICY.packs, costs: ECHO_VIDEO_POLICY.generation.costs, maxDurationSeconds: ECHO_VIDEO_POLICY.generation.maxDurationSeconds, maxConcurrentPerOwner: ECHO_VIDEO_POLICY.generation.maxConcurrentPerOwner },
      audioCredits: { monthlyLimit: audioCreditsLimit, used: audioCreditsUsed, remaining: Math.max(0,audioCreditsLimit-audioCreditsUsed), maxAudioSeconds: ECHO_AUDIO_POLICY.maxGeneratedAudioSeconds, creditsPerAudio: 1 },
      voice: { enabled: eligible && budget?.enabled === true, engineConfigured: Boolean(process.env.ECHO_KOKORO_TTS_URL),
        preference: eligible ? (budget?.preference ?? "off") : "off", monthlyCharacterLimit: monthlyLimit,
        usedCharacters, remainingCharacters: Math.max(0, monthlyLimit - usedCharacters),
        maxDailyMessages: dailyLimit, usedMessagesToday, remainingMessagesToday: Math.max(0, dailyLimit - usedMessagesToday) } });
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.name : "unknown" }, "Account entitlements unavailable");
    res.status(503).json({ error: "ENTITLEMENTS_UNAVAILABLE" });
  }
});
export default router;
