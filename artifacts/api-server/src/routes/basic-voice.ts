import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
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

/** Synthesizes a new phrase, not a static sample. No provider means no charge and no fake audio. */
router.post("/voices/basic/synthesize", requireAuth, async (req, res) => {
  const { universeId = "primary", characterId, text } = req.body ?? {};
  if (typeof universeId !== "string" || !universeId || universeId.length > 128 ||
      typeof characterId !== "string" || !characterId || characterId.length > 128 ||
      typeof text !== "string" || !text.trim() || text.length > 500) {
    res.status(400).json({ error: "INVALID_VOICE_REQUEST" }); return;
  }
  try {
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
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json", ...(process.env.ECHO_KOKORO_TTS_KEY ? { Authorization: `Bearer ${process.env.ECHO_KOKORO_TTS_KEY}` } : {}) },
      body: JSON.stringify({ model: "kokoro", input: text.trim(), voice, response_format: "wav" }),
      signal: AbortSignal.timeout(45000),
    });
    if (!response.ok) { res.status(502).json({ error: "VOICE_ENGINE_FAILED" }); return; }
    const data = Buffer.from(await response.arrayBuffer());
    if (data.length < 44 || data.length > 15 * 1024 * 1024 || data.toString("ascii", 0, 4) !== "RIFF" ||
        data.toString("ascii", 8, 12) !== "WAVE") {
      res.status(502).json({ error: "VOICE_ENGINE_INVALID_AUDIO" }); return;
    }
    res.setHeader("Content-Type", "audio/wav");
    res.setHeader("Cache-Control", "private, no-store");
    res.send(data);
  } catch (error) {
    req.log.warn({ err: error instanceof Error ? error.name : "unknown" }, "Basic voice synthesis unavailable");
    res.status(503).json({ error: "VOICE_SYNTHESIS_UNAVAILABLE" });
  }
});
export default router;
