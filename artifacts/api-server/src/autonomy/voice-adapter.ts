import { basicVoiceProviderReady, synthesizeBasicVoiceAudio } from "../lib/basicVoiceProvider";
import { randomUUID } from "node:crypto";
import { and, eq, gte, sql } from "drizzle-orm";
import { db, pool, echoMediaTable, echoVoiceBudgetsTable, echoVoiceUsageTable, echoUniversesTable } from "@workspace/db";
import { SaveUniverseBody } from "@workspace/api-zod";
import { canUseBasicVoices, resolveEchoPlan } from "../lib/entitlements";
import { elevenLabsHeaders, elevenLabsVoiceStatus } from "../lib/elevenLabsVoice";
import { configuredR2, signR2Request } from "../lib/cloudflareR2";
import { mp3DurationSeconds } from "../lib/mp3Duration";
import { reserveCharacterAudioCredit, refundFailedCharacterAudio } from "../lib/audioCredits";

const voices: Record<string, string> = {
  "echo-f-01": "af_heart", "echo-f-02": "af_bella", "echo-f-03": "af_nicole",
  "echo-f-04": "bf_emma", "echo-f-05": "bf_alice", "echo-m-01": "am_adam",
  "echo-m-02": "am_eric", "echo-m-03": "am_liam", "echo-m-04": "bm_daniel", "echo-m-05": "bm_george",
};
const month = () => new Date().toISOString().slice(0, 7);
/** Resolve the selected premium voice from owner-scoped storage; never trust a client voice ID. */
export async function resolveAutonomousVoiceId({ ownerId, universeId, characterId, basicVoiceId }: { ownerId: string; universeId: string; characterId: string; basicVoiceId?: string | null }): Promise<string | null> {
  // A linked social account uses the canonical person's selected Premium voice.
  // Resolve only inside this authenticated owner's universe, never from client input.
  const [universe] = await db.select({ state: echoUniversesTable.state })
    .from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId, ownerId),
      eq(echoUniversesTable.universeId, universeId),
    )).limit(1);
  const parsed = universe ? SaveUniverseBody.shape.state.safeParse(universe.state) : null;
  const account = parsed?.success ? parsed.data.characters.find(c => c.id === characterId) : undefined;
  const voiceOwnerId = account?.personId && parsed?.success &&
    parsed.data.characters.some(c => c.id === account.personId)
    ? account.personId : characterId;
  if (await resolveEchoPlan(ownerId) === "premium" && elevenLabsVoiceStatus(ownerId).generationAvailable) {
    const selected = await pool.query(`SELECT s.provider_sample_id
      FROM echo_voice_projects p JOIN echo_voice_samples s ON s.id=p.selected_sample_id
      WHERE p.owner_id=$1 AND p.universe_id=$2 AND p.character_id=$3
        AND p.status='ready' AND s.owner_id=$1 AND s.project_id=p.id
        AND s.provider IN ('elevenlabs','elevenlabs_catalog','elevenlabs_clone') AND s.status='ready' LIMIT 1`, [ownerId, universeId, voiceOwnerId]);
    const id = selected.rows[0]?.provider_sample_id;
    if (typeof id === "string" && /^[a-zA-Z0-9_-]{10,128}$/.test(id)) return `elevenlabs:${id}`;
  }
  return basicVoiceId && voices[basicVoiceId] ? basicVoiceId : null;
}

export async function getVoiceOwnerControls(ownerId: string) {
  if (!await canUseBasicVoices(ownerId)) return null;
  const [row] = await db.select().from(echoVoiceBudgetsTable).where(eq(echoVoiceBudgetsTable.ownerId, ownerId)).limit(1);
  const customReady = await resolveEchoPlan(ownerId) === "premium" && elevenLabsVoiceStatus(ownerId).generationAvailable;
  const engineReady = !!configuredR2() && (basicVoiceProviderReady() || customReady);
  const enabled = row?.enabled === true && engineReady;
  if (!enabled || !row) return null;
  const [spent] = await db.select({ total: sql<number>`coalesce(sum(${echoVoiceUsageTable.characters}),0)` })
    .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, ownerId), eq(echoVoiceUsageTable.monthKey, month())));
  const [daily] = await db.select({ total: sql<number>`count(*)` }).from(echoVoiceUsageTable)
    .where(and(eq(echoVoiceUsageTable.ownerId, ownerId), gte(echoVoiceUsageTable.createdAt, new Date(Date.now() - 86400000))));
  return { ownerEnabled: enabled, engineReady, maxVoiceMessagesPerDay: row.maxDailyMessages,
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

/** Narrate an explicitly requested turn using the same profile voice and account limits as DMs. */
export async function narrateSceneTurn(input: { ownerId: string; universeId: string; characterId: string; basicVoiceId?: string; text: string }) {
  const { ownerId, characterId, text } = input;
  const voiceId = await resolveAutonomousVoiceId(input);
  if (!voiceId) return null;
  const custom = voiceId.startsWith("elevenlabs:");
  if (!custom && !basicVoiceProviderReady()) throw Error("BASIC_VOICE_NOT_AVAILABLE");
  const reservation = await reserveVoiceNarration(ownerId, characterId, text);
  if (!reservation) throw Error("VOICE_BUDGET_EXHAUSTED_OR_DISABLED");
  const requestId = randomUUID();
  let charged = false;
  try {
    const credit = await reserveCharacterAudioCredit({ ownerId, characterId, requestKey: requestId,
      engine: custom ? "custom" : "kokoro", requestedSeconds: 30 });
    if (!credit.allowed) throw Error("VOICE_CREDITS_EXHAUSTED");
    charged = true;
    let audio: { bytes: Buffer; mimeType: string };
    if (custom) {
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId.slice("elevenlabs:".length))}?output_format=mp3_44100_128`, {
        method: "POST", headers: { ...elevenLabsHeaders(), Accept: "audio/mpeg" },
        body: JSON.stringify({ text, model_id: "eleven_multilingual_v2" }), signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw Error("ELEVENLABS_TTS_FAILED");
      const bytes = Buffer.from(await response.arrayBuffer());
      const seconds = mp3DurationSeconds(bytes);
      if (bytes.length < 100 || bytes.length > 10 * 1024 * 1024 || seconds === null || seconds <= 0 || seconds > 30)
        throw Error("CUSTOM_VOICE_AUDIO_INVALID");
      audio = { bytes, mimeType: "audio/mpeg" };
    } else {
      const result = await synthesizeBasicVoiceAudio({ text, voice: voices[voiceId], requestId });
      if (!Number.isFinite(result.seconds) || result.seconds <= 0 || result.seconds > 30) throw Error("VOICE_AUDIO_INVALID");
      audio = result;
    }
    await completeVoiceNarration(ownerId, reservation, true);
    return audio;
  } catch (error) {
    if (charged) await refundFailedCharacterAudio(ownerId, requestId).catch(() => undefined);
    await completeVoiceNarration(ownerId, reservation, false).catch(() => undefined);
    throw error;
  }
}

/** Voice is attached only after the text DM is committed; TTS failures never roll back the text. */
export async function dispatchAutonomousVoice(input: { ownerId: string; universeId: string; characterId: string; messageId: string; text: string; spokenText: string; voiceId: string }) {
  const r2 = configuredR2();
  if (!r2 || !await canUseBasicVoices(input.ownerId) || !input.spokenText.trim() || input.spokenText.length > 500) return;
  const custom = input.voiceId.startsWith("elevenlabs:");
  let audioBytes: Buffer;
  let mimeType: "audio/wav" | "audio/mpeg";
  let creditRequest: string | null = null;
  const reserved = await db.transaction(async tx => {
    const [budget] = await tx.select().from(echoVoiceBudgetsTable)
      .where(eq(echoVoiceBudgetsTable.ownerId, input.ownerId)).for("update").limit(1);
    if (!budget?.enabled || budget.preference === "off" || budget.maxDailyMessages <= 0) return false;
    const [used] = await tx.select({ total: sql<number>`coalesce(sum(${echoVoiceUsageTable.characters}),0)` })
      .from(echoVoiceUsageTable).where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId), eq(echoVoiceUsageTable.monthKey, month())));
    const [daily] = await tx.select({ total: sql<number>`count(*)` }).from(echoVoiceUsageTable)
      .where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId), gte(echoVoiceUsageTable.createdAt, new Date(Date.now() - 86400000))));
    if (Number(used?.total ?? 0) + input.spokenText.length > budget.monthlyCharacterLimit || Number(daily?.total ?? 0) >= budget.maxDailyMessages) return false;
    const inserted = await tx.insert(echoVoiceUsageTable).values({ ownerId: input.ownerId, messageId: input.messageId,
      monthKey: month(), characterId: input.characterId, characters: input.spokenText.length, status: "reserved" })
      .onConflictDoNothing().returning({ messageId: echoVoiceUsageTable.messageId });
    return inserted.length > 0;
  });
  if (!reserved) return;
  try {
    if (custom) {
      if (await resolveEchoPlan(input.ownerId) !== "premium" || !elevenLabsVoiceStatus(input.ownerId).generationAvailable) throw Error("CUSTOM_VOICE_NOT_AVAILABLE");
      const voiceId = input.voiceId.slice("elevenlabs:".length);
      if (!/^[a-zA-Z0-9_-]{10,128}$/.test(voiceId)) throw Error("CUSTOM_VOICE_ID_INVALID");
      creditRequest = randomUUID();
      const charge = await reserveCharacterAudioCredit({ ownerId: input.ownerId, characterId: input.characterId,
        requestKey: creditRequest, engine: "custom", requestedSeconds: 30 });
      if (!charge.allowed) { creditRequest = null; throw Error("CUSTOM_VOICE_CREDITS_EXHAUSTED"); }
      const response = await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}?output_format=mp3_44100_128`, {
        method: "POST", headers: { ...elevenLabsHeaders(), "Accept": "audio/mpeg" },
        body: JSON.stringify({ text: input.spokenText, model_id: "eleven_multilingual_v2" }), signal: AbortSignal.timeout(45000),
      });
      if (!response.ok) throw Error("ELEVENLABS_TTS_FAILED");
      audioBytes = Buffer.from(await response.arrayBuffer());
      const seconds = mp3DurationSeconds(audioBytes);
      if (audioBytes.length < 100 || audioBytes.length > 10 * 1024 * 1024 || seconds === null || seconds <= 0 || seconds > 30)
        throw Error("CUSTOM_VOICE_AUDIO_INVALID");
      mimeType = "audio/mpeg";
    } else {
      const voice = voices[input.voiceId];
      if (!voice || !basicVoiceProviderReady()) throw Error("BASIC_VOICE_NOT_AVAILABLE");
      const audio = await synthesizeBasicVoiceAudio({ text: input.spokenText, voice, requestId: input.messageId });
      audioBytes = audio.bytes; mimeType = audio.mimeType;
    }
    const objectKey = `r2/${randomUUID()}`;
    const objectPath = `/objects/${objectKey}`;
    const uploaded = await fetch(signR2Request(r2, "PUT", objectKey), {
      method: "PUT", redirect: "error", headers: { "Content-Type": mimeType },
      body: new Uint8Array(audioBytes), signal: AbortSignal.timeout(20000),
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
      const attachment = { id: `voice-${input.messageId}`, type: "audio" as const, url: objectPath, mimeType };
      const state = { ...parsed.data, messages: parsed.data.messages.map(m => m.id === input.messageId
        ? { ...m, text: `${m.text}\n\n[Transcripción de nota de voz]: ${input.spokenText}`, attachments: [...(m.attachments ?? []), attachment] } : m) };
      await tx.update(echoUniversesTable).set({ state, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date() })
        .where(and(eq(echoUniversesTable.ownerId, input.ownerId), eq(echoUniversesTable.universeId, input.universeId)));
      await tx.update(echoVoiceUsageTable).set({ status: "succeeded", objectPath }).where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId), eq(echoVoiceUsageTable.messageId, input.messageId)));
    });
    creditRequest = null;
  } catch (error) {
    if (creditRequest) await refundFailedCharacterAudio(input.ownerId, creditRequest).catch(() => undefined);
    await db.update(echoVoiceUsageTable).set({ status: "failed" }).where(and(eq(echoVoiceUsageTable.ownerId, input.ownerId),
      eq(echoVoiceUsageTable.messageId, input.messageId))).catch(() => undefined);
    throw error;
  }
}
