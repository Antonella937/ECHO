import assert from "node:assert/strict";
import { afterEach, test } from "node:test";
import { synthesizeDeapiMp3 } from "../src/lib/deapiSpeech";

const originalFetch = globalThis.fetch;
const originalKey = process.env.ECHO_DEAPI_TTS_KEY;
afterEach(() => {
  globalThis.fetch = originalFetch;
  if (originalKey === undefined) delete process.env.ECHO_DEAPI_TTS_KEY;
  else process.env.ECHO_DEAPI_TTS_KEY = originalKey;
});
const request = { text: "Hello ECHO", voice: "af_heart", requestId: "test-1" };
function validMp3(seconds: number): Buffer {
  const frame = Buffer.alloc(417);
  frame.writeUInt32BE(0xfffb9000, 0);
  return Buffer.concat(Array.from({ length: Math.ceil(seconds * 44100 / 1152) }, () => frame));
}
test("fails closed when no deAPI key is configured", async () => {
  delete process.env.ECHO_DEAPI_TTS_KEY;
  await assert.rejects(synthesizeDeapiMp3(request), { code: "DEAPI_NOT_CONFIGURED" });
});
test("submits Kokoro request, polls completed job and returns MP3", async () => {
  process.env.ECHO_DEAPI_TTS_KEY = "offline-test-key";
  let calls = 0;
  globalThis.fetch = async (url, init) => {
    calls++;
    if (calls === 1) {
      assert.equal(String(url), "https://api.deapi.ai/api/v2/audio/speech");
      assert.ok(init?.body instanceof FormData);
      assert.equal(init.body.get("model"), "Kokoro");
      assert.equal(init.body.get("lang"), "en-us");
      assert.equal(init.body.get("voice"), "af_heart");
      assert.equal(init.body.get("format"), "mp3");
      assert.equal(init.body.get("mode"), "custom_voice");
      return Response.json({ data: { request_id: "test-job-1" } });
    }
    if (calls === 2) {
      assert.equal(String(url), "https://api.deapi.ai/api/v2/jobs/test-job-1");
      return Response.json({ data: { status: "done", result_url: "https://api.deapi.ai/output/test.mp3" } });
    }
    assert.equal(String(url), "https://api.deapi.ai/output/test.mp3");
    return new Response(validMp3(2));
  };
  assert.ok((await synthesizeDeapiMp3(request)).length > 1000);
  assert.equal(calls, 3);
});
test("rejects untrusted audio download hosts", async () => {
  process.env.ECHO_DEAPI_TTS_KEY = "offline-test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ data: { request_id: "test-job" } });
    return Response.json({ data: { status: "done", result_url: "https://example.com/unsafe.mp3" } });
  };
  await assert.rejects(synthesizeDeapiMp3(request), { code: "DEAPI_UNTRUSTED_RESULT_HOST" });
  assert.equal(calls, 2);
});
test("rejects failed generation jobs", async () => {
  process.env.ECHO_DEAPI_TTS_KEY = "offline-test-key";
  let calls = 0;
  globalThis.fetch = async () => ++calls === 1
    ? Response.json({ data: { request_id: "test-job" } })
    : Response.json({ data: { status: "error" } });
  await assert.rejects(synthesizeDeapiMp3(request), { code: "DEAPI_GENERATION_FAILED" });
});

test("rejects audio exceeding the 30-second cap", async () => {
  process.env.ECHO_DEAPI_TTS_KEY = "offline-test-key";
  let calls = 0;
  globalThis.fetch = async () => {
    calls++;
    if (calls === 1) return Response.json({ data: { request_id: "test-job" } });
    if (calls === 2) return Response.json({ data: { status: "done", result_url: "https://api.deapi.ai/output/test.mp3" } });
    return new Response(validMp3(31));
  };
  await assert.rejects(synthesizeDeapiMp3(request), { code: "DEAPI_INVALID_DURATION" });
});
