import { mp3DurationSeconds } from "./mp3Duration";
/**
 * deAPI Kokoro job transport. Server-only and deliberately not activated by default.
 * Returns MP3; consumers must validate duration and store with audio/mpeg.
 * Documentation: https://deapi.ai/models/kokoro-tts
 */
export class DeapiSpeechError extends Error {
  constructor(public readonly code: string) { super(code); this.name = "DeapiSpeechError"; }
}
const ROOT = "https://api.deapi.ai/api/v2";
const MAX_BYTES = 15 * 1024 * 1024;
const MAX_POLLS = 20;
const delay = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));

function voiceLanguage(voice: string): string {
  if (/^[ab][fm]_/.test(voice)) return voice[0] === "a" ? "en-us" : "en-gb";
  throw new DeapiSpeechError("DEAPI_UNSUPPORTED_VOICE");
}
function resultUrl(value: unknown): URL {
  if (typeof value !== "string") throw new DeapiSpeechError("DEAPI_INVALID_RESULT_URL");
  let url: URL;
  try { url = new URL(value); } catch { throw new DeapiSpeechError("DEAPI_INVALID_RESULT_URL"); }
  // Do not allow redirects or untrusted hosts: provider output URLs are untrusted.
  if (url.protocol !== "https:" || url.username || url.password || url.port ||
      !["api.deapi.ai", "deapi.ai"].includes(url.hostname)) {
    throw new DeapiSpeechError("DEAPI_UNTRUSTED_RESULT_HOST");
  }
  return url;
}
async function json(response: Response): Promise<Record<string, any>> {
  if (!response.ok) throw new DeapiSpeechError("DEAPI_REQUEST_FAILED");
  const value: unknown = await response.json();
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new DeapiSpeechError("DEAPI_INVALID_RESPONSE");
  return value as Record<string, any>;
}

export async function synthesizeDeapiMp3(input: { text: string; voice: string; requestId: string }): Promise<Buffer> {
  const key = process.env.ECHO_DEAPI_TTS_KEY;
  if (!key) throw new DeapiSpeechError("DEAPI_NOT_CONFIGURED");
  if (!input.text.trim() || input.text.length > 500) throw new DeapiSpeechError("DEAPI_INVALID_TEXT");
  const headers = { Authorization: `Bearer ${key}`, Accept: "application/json" };
  const form = new FormData();
  for (const [field, value] of Object.entries({
    model: "Kokoro", text: input.text, voice: input.voice, lang: voiceLanguage(input.voice),
    speed: "1", format: "mp3", sample_rate: "24000", mode: "custom_voice",
  })) form.append(field, value);
  const submitted = await json(await fetch(`${ROOT}/audio/speech`, {
    method: "POST", headers, body: form, signal: AbortSignal.timeout(15_000),
  }));
  const id: unknown = submitted.data?.request_id;
  if (typeof id !== "string" || !/^[a-zA-Z0-9_-]{1,128}$/.test(id)) throw new DeapiSpeechError("DEAPI_INVALID_JOB_ID");
  for (let attempt = 0; attempt < MAX_POLLS; attempt++) {
    const status = await json(await fetch(`${ROOT}/jobs/${encodeURIComponent(id)}`, {
      headers: { Authorization: `Bearer ${key}`, Accept: "application/json" },
      signal: AbortSignal.timeout(10_000),
    }));
    const job = status.data;
    if (job?.status === "error" || job?.status === "failed") throw new DeapiSpeechError("DEAPI_GENERATION_FAILED");
    if (job?.status === "done" || job?.status === "completed") {
      const url = resultUrl(job.result_url);
      const response = await fetch(url, { redirect: "error", signal: AbortSignal.timeout(15_000) });
      if (!response.ok) throw new DeapiSpeechError("DEAPI_DOWNLOAD_FAILED");
      const length = response.headers.get("content-length");
      if (length && Number(length) > MAX_BYTES) throw new DeapiSpeechError("DEAPI_AUDIO_TOO_LARGE");
      const bytes = Buffer.from(await response.arrayBuffer());
      if (bytes.length < 4 || bytes.length > MAX_BYTES ||
          !(bytes.toString("ascii", 0, 3) === "ID3" ||
            (bytes[0] === 0xff && (bytes[1] & 0xe0) === 0xe0))) {
        throw new DeapiSpeechError("DEAPI_INVALID_MP3");
      }
      const seconds = mp3DurationSeconds(bytes);
      if (seconds === null || seconds <= 0 || seconds > 30) {
        throw new DeapiSpeechError("DEAPI_INVALID_DURATION");
      }
      return bytes;
    }
    if (!["queued", "pending", "processing", "running"].includes(String(job?.status))) {
      throw new DeapiSpeechError("DEAPI_UNKNOWN_JOB_STATUS");
    }
    await delay(1000);
  }
  throw new DeapiSpeechError("DEAPI_TIMEOUT");
}
