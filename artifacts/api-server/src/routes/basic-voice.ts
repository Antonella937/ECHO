import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { reserveCharacterAudioCredit, refundFailedCharacterAudio } from "../lib/audioCredits";
import { ECHO_AUDIO_POLICY } from "../lib/entitlements";
import { requireAuth } from "../middlewares/requireAuth";
import { canUseBasicVoices } from "../lib/entitlements";
import { reserveVoiceNarration, completeVoiceNarration } from "../autonomy/voice-adapter";
import { readUniverse } from "../lib/universeRepository";
import { db, echoMediaTable, echoUniversesTable } from "@workspace/db";
import { and, eq, isNull, sql } from "drizzle-orm";
import { SaveUniverseBody } from "@workspace/api-zod";

/** Free voice IDs are fixed; the client cannot choose an arbitrary provider voice. */
const voices: Record<string, string> = {
  "echo-f-01": "af_heart", "echo-f-02": "af_bella", "echo-f-03": "af_nicole",
  "echo-f-04": "bf_emma", "echo-f-05": "bf_alice",
  "echo-m-01": "am_adam", "echo-m-02": "am_eric", "echo-m-03": "am_liam",
  "echo-m-04": "bm_daniel", "echo-m-05": "bm_george",
};
const router: IRouter = Router();
const recentRequests = new Map<string, number[]>();
/** WAV RIFF byte rate is at offset 28; reject any audio longer than the plan limit. */
function wavDurationSeconds(data: Buffer): number {
  if (data.length < 44 || data.toString("ascii",0,4)!=="RIFF" || data.toString("ascii",8,12)!=="WAVE") return Infinity;
  const byteRate=data.readUInt32LE(28);
  if (!byteRate) return Infinity;
  let offset=12;
  while(offset+8<=data.length) {
    const chunkSize=data.readUInt32LE(offset+4);
    if(data.toString("ascii",offset,offset+4)==="data") return chunkSize/byteRate;
    offset+=8+chunkSize+(chunkSize%2);
  }
  return Infinity;
}


/** Synthesizes a new phrase, not a static sample. No provider means no charge and no fake audio. */
router.post("/voices/basic/synthesize", requireAuth, async (req, res) => {
  const { universeId = "primary", characterId, text } = req.body ?? {};
  if (typeof universeId !== "string" || !universeId || universeId.length > 128 ||
      typeof characterId !== "string" || !characterId || characterId.length > 128 ||
      typeof text !== "string" || !text.trim() || text.length > 500) {
    res.status(400).json({ error: "INVALID_VOICE_REQUEST" }); return;
  }
  try {
    if (!await canUseBasicVoices(req.userId!)) { res.status(403).json({ error: "ECHO_PLUS_REQUIRED" }); return; }
    const snapshot = await readUniverse(req.userId!, universeId);
    const parsed = SaveUniverseBody.shape.state.safeParse(snapshot.state);
    if (!parsed.success) { res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return; }
    const character = parsed.data.characters.find(c => c.id === characterId && !c.archived);
    if (!character) { res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return; }
    const voiceId = character.configuration?.voice?.basicVoiceId ?? "";
    const voice = voices[voiceId];
    if (!voice) { res.status(409).json({ error: "CHARACTER_VOICE_NOT_SELECTED" }); return; }
    const endpoint = process.env.ECHO_KOKORO_TTS_URL;
    if (!endpoint) { res.status(503).json({ error: "VOICE_ENGINE_NOT_CONFIGURED" }); return; }
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      res.status(503).json({ error: "VOICE_ENGINE_INVALID_CONFIGURATION" }); return;
    }
    const now = Date.now();
    const recent = (recentRequests.get(req.userId!) ?? []).filter(time => now - time < 60_000);
    if (recent.length >= 5) { res.status(429).json({ error: "VOICE_RATE_LIMITED" }); return; }
    recent.push(now); recentRequests.set(req.userId!, recent);
    const reservation = await reserveVoiceNarration(req.userId!, characterId, text.trim());
    if (!reservation) { res.status(429).json({ error: "VOICE_BUDGET_EXHAUSTED_OR_DISABLED" }); return; }
    const audioRequestKey = randomUUID();
    const audioCredit = await reserveCharacterAudioCredit({ ownerId:req.userId!,characterId,requestKey:audioRequestKey,engine:"kokoro",requestedSeconds:ECHO_AUDIO_POLICY.maxGeneratedAudioSeconds });
    if (!audioCredit.allowed) {
      await completeVoiceNarration(req.userId!,reservation,false);
      res.status(429).json({error:audioCredit.reason,remainingCredits:audioCredit.remaining});return;
    }
    try {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.ECHO_KOKORO_TTS_KEY ? { Authorization: `Bearer ${process.env.ECHO_KOKORO_TTS_KEY}` } : {}) },
      body: JSON.stringify({ model: "kokoro", input: text.trim(), voice, response_format: "wav" }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) { await refundFailedCharacterAudio(req.userId!,audioRequestKey); await completeVoiceNarration(req.userId!, reservation, false); res.status(502).json({ error: "VOICE_ENGINE_FAILED" }); return; }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 44 || data.length > 15 * 1024 * 1024 || data.toString("ascii", 0, 4) !== "RIFF" ||
        data.toString("ascii", 8, 12) !== "WAVE") {
      await refundFailedCharacterAudio(req.userId!,audioRequestKey);
      await completeVoiceNarration(req.userId!, reservation, false);
      res.status(502).json({ error: "VOICE_ENGINE_INVALID_AUDIO" }); return;
    }
    const seconds=wavDurationSeconds(data);
    if (!Number.isFinite(seconds) || seconds<=0 || seconds>ECHO_AUDIO_POLICY.maxGeneratedAudioSeconds) {
      await refundFailedCharacterAudio(req.userId!,audioRequestKey);
      await completeVoiceNarration(req.userId!,reservation,false);
      res.status(502).json({error:"VOICE_AUDIO_EXCEEDS_30_SECONDS"});return;
    }
    await completeVoiceNarration(req.userId!, reservation, true);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(data);
    } catch (error) {
      await refundFailedCharacterAudio(req.userId!,audioRequestKey);
      await completeVoiceNarration(req.userId!,reservation,false).catch(()=>{});
      throw error;
    }
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.name : "unknown" }, "Basic voice synthesis unavailable");
    res.status(503).json({ error: "VOICE_SYNTHESIS_UNAVAILABLE" });
  }
});


/** On-demand listening: synthesize only the saved character's own DM text. */
router.post("/voices/basic/listen", requireAuth, async (req, res) => {
  const { universeId = "primary", characterId, messageId } = req.body ?? {};
  if ([universeId, characterId, messageId].some(v => typeof v !== "string" || !v || v.length > 128)) {
    res.status(400).json({ error: "INVALID_LISTEN_REQUEST" }); return;
  }
  try {
    if (!await canUseBasicVoices(req.userId!)) { res.status(403).json({ error: "ECHO_PLUS_REQUIRED" }); return; }
    const snapshot = await readUniverse(req.userId!, universeId);
    const parsed = SaveUniverseBody.shape.state.safeParse(snapshot.state);
    if (!parsed.success) { res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return; }
    const character = parsed.data.characters.find(c => c.id === characterId && !c.archived);
    const voiceId = character?.configuration?.voice?.basicVoiceId ?? "";
    const voice = voices[voiceId];
    if (!voice) { res.status(409).json({ error: "CHARACTER_VOICE_NOT_SELECTED" }); return; }
    const message = parsed.data.messages.find(m => m.id === messageId && m.senderId === characterId &&
      !m.hiddenForIds?.includes(req.userId!) && !m.hiddenForIds?.includes(characterId));
    if (!message) { res.status(404).json({ error: "MESSAGE_NOT_FOUND" }); return; }
    const text = message.text.replace(/\\[Transcripción de nota de voz\\]:/g, "").trim();
    if (!text || text.length > 500) { res.status(422).json({ error: "MESSAGE_NOT_SPEAKABLE" }); return; }
    const endpoint = process.env.ECHO_KOKORO_TTS_URL;
    if (!endpoint) { res.status(503).json({ error: "VOICE_ENGINE_NOT_CONFIGURED" }); return; }
    const url = new URL(endpoint);
    if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
      res.status(503).json({ error: "VOICE_ENGINE_INVALID_CONFIGURATION" }); return;
    }
    const now = Date.now();
    const recent = (recentRequests.get(req.userId!) ?? []).filter(time => now - time < 60_000);
    if (recent.length >= 5) { res.status(429).json({ error: "VOICE_RATE_LIMITED" }); return; }
    recent.push(now); recentRequests.set(req.userId!, recent);
    const reservation = await reserveVoiceNarration(req.userId!, characterId, text);
    if (!reservation) { res.status(429).json({ error: "VOICE_BUDGET_EXHAUSTED_OR_DISABLED" }); return; }
    const audioRequestKey = randomUUID();
    const audioCredit = await reserveCharacterAudioCredit({ ownerId:req.userId!,characterId,requestKey:audioRequestKey,engine:"kokoro",requestedSeconds:ECHO_AUDIO_POLICY.maxGeneratedAudioSeconds });
    if (!audioCredit.allowed) {
      await completeVoiceNarration(req.userId!,reservation,false);
      res.status(429).json({error:audioCredit.reason,remainingCredits:audioCredit.remaining});return;
    }
    try {
    const response = await fetch(url, {
      method: "POST", headers: { "Content-Type": "application/json",
        ...(process.env.ECHO_KOKORO_TTS_KEY ? { Authorization: `Bearer ${process.env.ECHO_KOKORO_TTS_KEY}` } : {}) },
      body: JSON.stringify({ model: "kokoro", input: text, voice, response_format: "wav" }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) { await refundFailedCharacterAudio(req.userId!,audioRequestKey); await completeVoiceNarration(req.userId!, reservation, false); res.status(502).json({ error: "VOICE_ENGINE_FAILED" }); return; }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 44 || data.length > 15 * 1024 * 1024 || data.toString("ascii", 0, 4) !== "RIFF" ||
      data.toString("ascii", 8, 12) !== "WAVE") {
      await refundFailedCharacterAudio(req.userId!,audioRequestKey);
      await completeVoiceNarration(req.userId!, reservation, false);
      res.status(502).json({ error: "VOICE_ENGINE_INVALID_AUDIO" }); return;
    }
    const seconds=wavDurationSeconds(data);
    if (!Number.isFinite(seconds) || seconds<=0 || seconds>ECHO_AUDIO_POLICY.maxGeneratedAudioSeconds) {
      await refundFailedCharacterAudio(req.userId!,audioRequestKey);
      await completeVoiceNarration(req.userId!,reservation,false);
      res.status(502).json({error:"VOICE_AUDIO_EXCEEDS_30_SECONDS"});return;
    }
    await completeVoiceNarration(req.userId!, reservation, true);
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(data);
    } catch (error) {
      await refundFailedCharacterAudio(req.userId!,audioRequestKey);
      await completeVoiceNarration(req.userId!,reservation,false).catch(()=>{});
      throw error;
    }
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.name : "unknown" }, "Voice listening unavailable");
    res.status(503).json({ error: "VOICE_LISTEN_UNAVAILABLE" });
  }
});

/** Attach a privately uploaded WAV to the existing character-authored DM.
 * The message text remains untouched and is the canonical conversational memory.
 */
router.post("/voices/basic/attach-to-dm", requireAuth, async (req, res) => {
  const { universeId = "primary", characterId, messageId, objectPath } = req.body ?? {};
  if ([universeId, characterId, messageId, objectPath].some(v => typeof v !== "string") ||
      universeId.length > 128 || characterId.length > 128 || messageId.length > 128 ||
      !objectPath.startsWith("/objects/") || objectPath.includes("..")) {
    res.status(400).json({ error: "INVALID_VOICE_ATTACHMENT" }); return;
  }
  try {
    if (!await canUseBasicVoices(req.userId!)) { res.status(403).json({ error: "ECHO_PLUS_REQUIRED" }); return; }
    const [owned] = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable)
      .where(and(eq(echoMediaTable.ownerId, req.userId!), eq(echoMediaTable.objectPath, objectPath))).limit(1);
    if (!owned) { res.status(404).json({ error: "AUDIO_NOT_OWNED" }); return; }
    const result = await db.transaction(async tx => {
      const [universe] = await tx.select().from(echoUniversesTable).where(and(
        eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId),
        isNull(echoUniversesTable.archivedAt), isNull(echoUniversesTable.deletedAt),
      )).for("update").limit(1);
      if (!universe) return "UNIVERSE_NOT_FOUND";
      const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
      if (!parsed.success) return "INVALID_UNIVERSE";
      const character = parsed.data.characters.find(c => c.id === characterId && !c.archived);
      if (!character?.configuration?.voice?.basicVoiceId || !voices[character.configuration.voice.basicVoiceId]) return "VOICE_NOT_SELECTED";
      const message = parsed.data.messages.find(m => m.id === messageId && m.senderId === characterId &&
        m.text.trim() && m.text.length <= 500 && !m.hiddenForIds?.includes(characterId));
      if (!message) return "CHARACTER_MESSAGE_NOT_FOUND";
      if (message.attachments?.some(a => a.type === "audio")) return "ALREADY_HAS_AUDIO";
      const attachment = { id: `voice-${messageId}`, type: "audio" as const, url: objectPath, mimeType: "audio/wav" };
      const state = { ...parsed.data, messages: parsed.data.messages.map(m => m.id === messageId
        ? { ...m, attachments: [...(m.attachments ?? []), attachment] } : m) };
      const updated = await tx.update(echoUniversesTable).set({
        state, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date(),
      }).where(and(eq(echoUniversesTable.ownerId, req.userId!), eq(echoUniversesTable.universeId, universeId)))
        .returning({ revision: echoUniversesTable.revision });
      return updated.length ? "OK" : "WRITE_FAILED";
    });
    if (result !== "OK") { res.status(result === "ALREADY_HAS_AUDIO" ? 409 : 422).json({ error: result }); return; }
    res.json({ ok: true, messageId, objectPath });
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.name : "unknown" }, "Voice attachment failed");
    res.status(503).json({ error: "VOICE_ATTACHMENT_UNAVAILABLE" });
  }
});
export default router;
