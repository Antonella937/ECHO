import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { basicVoiceProviderReady, synthesizeBasicVoice } from "../src/lib/basicVoiceProvider";

const originalFetch = globalThis.fetch;
const originalUrl = process.env.ECHO_KOKORO_TTS_URL;
const originalKey = process.env.ECHO_KOKORO_TTS_KEY;
const originalProvider = process.env.ECHO_BASIC_TTS_PROVIDER;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalUrl === undefined) delete process.env.ECHO_KOKORO_TTS_URL;
  else process.env.ECHO_KOKORO_TTS_URL = originalUrl;
  if (originalKey === undefined) delete process.env.ECHO_KOKORO_TTS_KEY;
  else process.env.ECHO_KOKORO_TTS_KEY = originalKey;
  if (originalProvider === undefined) delete process.env.ECHO_BASIC_TTS_PROVIDER;
  else process.env.ECHO_BASIC_TTS_PROVIDER = originalProvider;
});

const request = { text: "Hello ECHO", voice: "af_heart", requestId: "test-1" };
const wav = () => {
  const bytes = Buffer.alloc(44);
  bytes.write("RIFF", 0, "ascii");
  bytes.write("WAVE", 8, "ascii");
  return bytes;
};

test("provider is disabled without endpoint", () => {
  delete process.env.ECHO_KOKORO_TTS_URL;
  assert.equal(basicVoiceProviderReady(), false);
});

test("rejects HTTP endpoints without making requests", async () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "kokoro";
  process.env.ECHO_KOKORO_TTS_URL = "http://localhost:8880/v1/audio/speech";
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("unexpected"); };
  await assert.rejects(synthesizeBasicVoice(request), { code: "VOICE_ENGINE_INVALID_CONFIGURATION" });
  assert.equal(calls, 0);
});

test("rejects unimplemented providers without making requests", async () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "deapi";
  process.env.ECHO_KOKORO_TTS_URL = "https://example.com/v1/audio/speech";
  let calls = 0;
  globalThis.fetch = async () => { calls++; throw Error("unexpected"); };
  await assert.rejects(synthesizeBasicVoice(request), { code: "VOICE_PROVIDER_NOT_IMPLEMENTED" });
  assert.equal(calls, 0);
});

test("sends Kokoro-compatible request with server-only key", async () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "kokoro";
  process.env.ECHO_KOKORO_TTS_URL = "https://example.com/v1/audio/speech";
  process.env.ECHO_KOKORO_TTS_KEY = "test-secret";
  globalThis.fetch = async (url, init) => {
    assert.equal(String(url), process.env.ECHO_KOKORO_TTS_URL);
    assert.equal((init?.headers as Record<string, string>).Authorization, "Bearer test-secret");
    assert.deepEqual(JSON.parse(String(init?.body)), {
      model: "kokoro", input: "Hello ECHO", voice: "af_heart", response_format: "wav",
    });
    return new Response(wav(), { status: 200 });
  };
  assert.deepEqual(await synthesizeBasicVoice(request), wav());
});

test("rejects non-WAV responses", async () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "kokoro";
  process.env.ECHO_KOKORO_TTS_URL = "https://example.com/v1/audio/speech";
  globalThis.fetch = async () => new Response(Buffer.alloc(64, 42), { status: 200 });
  await assert.rejects(synthesizeBasicVoice(request), { code: "VOICE_ENGINE_INVALID_AUDIO" });
});

test("rejects provider HTTP failures", async () => {
  process.env.ECHO_BASIC_TTS_PROVIDER = "kokoro";
  process.env.ECHO_KOKORO_TTS_URL = "https://example.com/v1/audio/speech";
  globalThis.fetch = async () => new Response("unavailable", { status: 503 });
  await assert.rejects(synthesizeBasicVoice(request), { code: "VOICE_ENGINE_FAILED" });
});
