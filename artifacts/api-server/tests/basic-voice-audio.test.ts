import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { basicVoiceProviderReady, synthesizeBasicVoiceAudio } from "../src/lib/basicVoiceProvider";

const oldFetch = globalThis.fetch;
const oldProvider = process.env.ECHO_BASIC_TTS_PROVIDER;
const oldKokoro = process.env.ECHO_KOKORO_TTS_URL;
const oldDeapi = process.env.ECHO_DEAPI_TTS_KEY;
afterEach(() => {
  globalThis.fetch = oldFetch;
  if (oldProvider === undefined) delete process.env.ECHO_BASIC_TTS_PROVIDER;
  else process.env.ECHO_BASIC_TTS_PROVIDER = oldProvider;
  if (oldKokoro === undefined) delete process.env.ECHO_KOKORO_TTS_URL;
  else process.env.ECHO_KOKORO_TTS_URL = oldKokoro;
  if (oldDeapi === undefined) delete process.env.ECHO_DEAPI_TTS_KEY;
  else process.env.ECHO_DEAPI_TTS_KEY = oldDeapi;
});
const request = { text: "Hello ECHO", voice: "af_heart", requestId: "offline-voice" };
function wav(): Buffer {
  const bytes = Buffer.alloc(48);
  bytes.write("RIFF", 0); bytes.write("WAVE", 8);
  bytes.writeUInt32LE(8000, 28);
  bytes.write("data", 36); bytes.writeUInt32LE(4, 40);
  return bytes;
}
function mp3(): Buffer {
  const frame = Buffer.alloc(417); frame.writeUInt32BE(0xfffb9000, 0);
  return Buffer.concat(Array.from({ length: 77 }, () => frame));
}
test("WAV adapter returns typed audio with measured duration", async () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "kokoro";
  process.env.ECHO_KOKORO_TTS_URL = "https://example.com/tts";
  globalThis.fetch = async () => new Response(wav());
  const result = await synthesizeBasicVoiceAudio(request);
  assert.equal(result.mimeType, "audio/wav");
  assert.ok(result.seconds > 0 && result.seconds < 30);
});
test("deAPI adapter returns MP3 without requiring Kokoro endpoint", async () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "deapi";
  delete process.env.ECHO_KOKORO_TTS_URL;
  process.env.ECHO_DEAPI_TTS_KEY = "offline-key";
  assert.equal(basicVoiceProviderReady(), true);
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ data: { request_id: "job1" } });
    if (calls === 2) return Response.json({ data: { status: "done", result_url: "https://api.deapi.ai/audio.mp3" } });
    return new Response(mp3());
  };
  const result = await synthesizeBasicVoiceAudio(request);
  assert.equal(result.mimeType, "audio/mpeg");
  assert.ok(result.seconds > 1 && result.seconds < 30);
  assert.equal(calls, 3);
});
test("deAPI is not ready without a key", () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "deapi";
  delete process.env.ECHO_DEAPI_TTS_KEY;
  assert.equal(basicVoiceProviderReady(), false);
});
