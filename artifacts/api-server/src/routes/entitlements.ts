import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { resolveEchoPlan } from "../lib/entitlements";
import { db, echoVoiceBudgetsTable, echoVoiceUsageTable } from "@workspace/db";
import { and, eq, gte, sql } from "drizzle-orm";

/** Read-only, server-authoritative account capabilities. Never accepts a plan from the client. */
const router: IRouter = Router();
router.get("/account/entitlements", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const ownerId = req.userId!;
    const plan = await resolveEchoPlan(ownerId);
    const [budget] = await db.select().from(echoVoiceBudgetsTable).where(eq(echoVoiceBudgetsTable.ownerId, ownerId)).limit(1);
    const monthKey = new Date().toISOString().slice(0, 7);
    const [monthly] = await db.select({ used: sql<number>`coalesce(sum(${echoVoiceUsageTable.characters}),0)` })
      .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, ownerId), eq(echoVoiceUsageTable.monthKey, monthKey)));
    const [daily] = await db.select({ used: sql<number>`count(*)` })
      .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, ownerId), gte(echoVoiceUsageTable.createdAt, new Date(Date.now() - 86400000))));
    const eligible = plan !== "free";
    const usedCharacters = Number(monthly?.used ?? 0);
    const usedMessagesToday = Number(daily?.used ?? 0);
    const monthlyLimit = eligible ? (budget?.monthlyCharacterLimit ?? 0) : 0;
    const dailyLimit = eligible ? (budget?.maxDailyMessages ?? 0) : 0;
    res.json({ plan, features: { basicVoices: eligible, customVoices: false, music: false, videos: false },
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
