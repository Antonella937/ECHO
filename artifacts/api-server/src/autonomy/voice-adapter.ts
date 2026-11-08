import { basicVoiceProviderReady, synthesizeBasicVoiceAudio } from "../lib/basicVoiceProvider";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, echoMediaTable, echoVoiceBudgetsTable, echoVoiceUsageTable, echoUniversesTable } from "@workspace/db";
import { SaveUniverseBody } from "@workspace/api-zod";
import { canUseBasicVoices } from "../lib/entitlements";

const voices: Record<string, string> = {
  "echo-f-01": "af_heart", "echo-f-02": "af_bella", "echo-f-03": "af_nicole",
  "echo-f-04": "bf_emma", "echo-f-05": "bf_alice", "echo-m-01": "am_adam",
  "echo-m-02": "am_eric", "echo-m-03": "am_liam", "echo-m-04": "bm_daniel", "echo-m-05": "bm_george",
};
const month = () => new Date().toISOString().slice(0, 7);

export async function getVoiceOwnerControls(ownerId: string) {
  if (!await canUseBasicVoices(ownerId)) return null;
  const [row] = await db.select().from(echoVoiceBudgetsTable).where(eq(echoVoiceBudgetsTable.ownerId, ownerId)).limit(1);
  const enabled = row?.enabled === true && basicVoiceProviderReady() && !!process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!enabled) return null;
  const [spent] = await db.select({ total: sql<number>`coalesce(sum(${echoVoiceUsageTable.characters}),0)` })
    .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, ownerId), eq(echoVoiceUsageTable.monthKey, month())));
  const [daily] = await db.select({ total: sql<number>`count(*)` }).from(echoVoiceUsageTable)
    .where(and(eq(echoVoiceUsageTable.ownerId, ownerId), gte(echoVoiceUsageTable.createdAt, new Date(Date.now() - 86400000))));
  return { ownerEnabled: enabled, engineReady: true, maxVoiceMessagesPerDay: row.maxDailyMessages,
    voiceMessagesToday: Number(daily?.total ?? 0), remainingCharacters: Math.max(0, row.monthlyCharacterLimit - Number(spent?.total ?? 0)),
    preference: row.preference };
}

/** Reserve a one-off narration against the same persistent owner budget. */
export async function reserveVoiceNarration(ownerId: string, characterId: string, text: string): Promise<string | null> {
  if (!await canUseBasicVoices(ownerId) || !text.trim() || text.length > 500) return null;
  return db.transaction(async tx => {
    const [budget] = await tx.select().from(echoVoiceBudgetsTable).where(eq(echoVoiceBudgetsTable.ownerId, ownerId)).for("update").limit(1);
    if (!budget?.enabled || budget.maxDailyMessages <= 0) return null;
    const [monthly] = await tx.select({ total: sql<number>`coalesce(sum(${echoVoiceUsageTable.characters}),0)` }).from(echoVoiceUsageTable)
      .where(and(eq(echoVoiceUsageTable.ownerId, ownerId), eq(echoVoiceUsageTable.monthKey, month())));
    const [daily] = await tx.select({ total: sql<number>`count(*)` }).from(echoVoiceUsageTable)
      .where(and(eq(echoVoiceUsageTable.ownerId, ownerId), gte(echoVoiceUsageTable.createdAt, new Date(Date.now() - 86400000))));
    if (Number(monthly?.total ?? 0) + text.length > budget.monthlyCharacterLimit || Number(daily?.total ?? 0) >= budget.maxDailyMessages) return null;
    const id = randomUUID();
    await tx.insert(echoVoiceUsageTable).values({ ownerId, messageId: id, monthKey: month(), characterId, characters: text.length, status: "reserved" });
    return id;
  });
}
export async function completeVoiceNarration(ownerId: string, id: string, succeeded: boolean) {
  await db.update(echoVoiceUsageTable).set({ status: succeeded ? "succeeded" : "failed" })
    .where(and(eq(echoVoiceUsageTable.ownerId, ownerId), eq(echoVoiceUsageTable.messageId, id)));
}

/** Atomic reservation before any provider request; failed jobs retain their reservation to avoid retry charges. */
export async function dispatchAutonomousVoice(input: { ownerId: string; universeId: string; characterId: string; messageId: string; text: string; voiceId: string }) {
  if (!await canUseBasicVoices(input.ownerId)) return;
  const voice = voices[input.voiceId];
  if (!voice || !input.text.trim() || input.text.length > 500) return;
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!basicVoiceProviderReady() || !base || !key || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base)) return;
  const reserved = await db.transaction(async tx => {
    const [budget] = await tx.select().from(echoVoiceBudgetsTable)
      .where(eq(echoVoiceBudgetsTable.ownerId, input.ownerId)).for("update").limit(1);
    if (!budget?.enabled || budget.preference === "off" || budget.maxDailyMessages <= 0) return false;
    const [used] = await tx.select({ total: sql<number>`coalesce(sum(${echoVoiceUsageTable.characters}),0)` })
      .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId), eq(echoVoiceUsageTable.monthKey, month())));
    const [daily] = await tx.select({ total: sql<number>`count(*)` }).from(echoVoiceUsageTable)
      .where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId), gte(echoVoiceUsageTable.createdAt, new Date(Date.now() - 86400000))));
    if (Number(used?.total ?? 0) + input.text.length > budget.monthlyCharacterLimit || Number(daily?.total ?? 0) >= budget.maxDailyMessages) return false;
    const inserted = await tx.insert(echoVoiceUsageTable).values({ ownerId: input.ownerId, messageId: input.messageId,
      monthKey: month(), characterId: input.characterId, characters: input.text.length, status: "reserved" })
      .onConflictDoNothing().returning({ messageId: echoVoiceUsageTable.messageId });
    return inserted.length > 0;
  });
  if (!reserved) return;
  try {
    const audio = await synthesizeBasicVoiceAudio({ text: input.text, voice, requestId: input.messageId });
    const { bytes } = audio;
    const objectPath = `/objects/uploads/${randomUUID()}`;
    const uploaded = await fetch(`${base}/storage/v1/object/echo-media/${objectPath.slice("/objects/".length)}`, {
      method: "POST", headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": audio.mimeType, "x-upsert": "false" },
      body: bytes, signal: AbortSignal.timeout(20000),
    });
    if (!uploaded.ok) throw Error("VOICE_UPLOAD_FAILED");
    await db.transaction(async tx => {
      const [universe] = await tx.select().from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, input.ownerId),
        eq(echoUniversesTable.universeId, input.universeId))).for("update").limit(1);
      if (!universe || universe.archivedAt || universe.deletedAt) throw Error("VOICE_UNIVERSE_UNAVAILABLE");
      const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
      if (!parsed.success) throw Error("VOICE_STATE_INVALID");
      const message = parsed.data.messages.find(m => m.id === input.messageId && m.senderId === input.characterId && m.text === input.text);
      if (!message || message.attachments?.some(a => a.type === "audio")) throw Error("VOICE_MESSAGE_CHANGED");
      await tx.insert(echoMediaTable).values({ ownerId: input.ownerId, objectPath });
      const attachment = { id: `voice-${input.messageId}`, type: "audio" as const, url: objectPath, mimeType: audio.mimeType };
      const state = { ...parsed.data, messages: parsed.data.messages.map(m => m.id === input.messageId
        ? { ...m, attachments: [...(m.attachments ?? []), attachment] } : m) };
      await tx.update(echoUniversesTable).set({ state, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date() })
        .where(and(eq(echoUniversesTable.ownerId, input.ownerId), eq(echoUniversesTable.universeId, input.universeId)));
      await tx.update(echoVoiceUsageTable).set({ status: "succeeded", objectPath }).where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId), eq(echoVoiceUsageTable.messageId, input.messageId)));
    });
  } catch (error) {
    await db.update(echoVoiceUsageTable).set({ status: "failed" }).where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId),
      eq(echoVoiceUsageTable.messageId, input.messageId))).catch(() => undefined);
    throw error;
  }
}
