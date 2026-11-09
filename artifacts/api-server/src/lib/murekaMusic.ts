/** Mureka V8 / fal.ai transport. Only invoke after verified entitlement and an
 * atomic Neon reservation; never expose FAL_KEY to browser clients.
 * Queue submissions can incur charges even when later processing fails.
 */
export const MUREKA_SONG_MODEL = "mureka/v8/generate/song";
export type MurekaSongInput = { prompt: string; lyrics?: string; enable_safety_checker: true };
export type MurekaSongResult = {
  songId: string | null;
  audioUrl: string;
  durationSeconds: number | null;
  contentType: string | null;
  fileSize: number | null;
};

function falKey(): string {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY_NOT_CONFIGURED");
  return key;
}
function falHeaders(): Record<string, string> {
  return { Authorization: `Key ${falKey()}`, "Content-Type": "application/json" };
}
function falAudioUrl(value: unknown): string {
  if (typeof value !== "string") throw new Error("MUREKA_AUDIO_MISSING");
  const url = new URL(value);
  if (url.protocol !== "https:" || url.username || url.password || url.port) throw new Error("MUREKA_AUDIO_URL_INVALID");
  // fal's hosted file domains. Do not fetch arbitrary URLs from model output.
  if (!(url.hostname === "fal.media" || url.hostname.endsWith(".fal.media")
    || url.hostname === "fal.ai" || url.hostname.endsWith(".fal.ai")
    || url.hostname === "fal.run" || url.hostname.endsWith(".fal.run"))) {
    throw new Error("MUREKA_AUDIO_HOST_UNTRUSTED");
  }
  return url.toString();
}
export function parseMurekaSongResult(data: unknown): MurekaSongResult {
  if (!data || typeof data !== "object") throw new Error("MUREKA_RESULT_INVALID");
  const result = data as Record<string, unknown>;
  const audio = result.audio;
  if (!audio || typeof audio !== "object") throw new Error("MUREKA_AUDIO_MISSING");
  const file = audio as Record<string, unknown>;
  const duration = typeof result.duration === "number" && Number.isFinite(result.duration)
    ? Math.max(0, Math.round(result.duration / 1000)) : null;
  return {
    songId: typeof result.song_id === "string" ? result.song_id : null,
    audioUrl: falAudioUrl(file.url),
    durationSeconds: duration,
    contentType: typeof file.content_type === "string" ? file.content_type : null,
    fileSize: typeof file.file_size === "number" ? file.file_size : null,
  };
}
/** Billable: requires a reserved generation job before calling. */
export async function submitMurekaSong(input: MurekaSongInput): Promise<string> {
  const response = await fetch(`https://queue.fal.run/${MUREKA_SONG_MODEL}`, {
    method: "POST", headers: falHeaders(), body: JSON.stringify(input),
    signal: AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`MUREKA_SUBMIT_HTTP_${response.status}`);
  const data = await response.json() as { request_id?: unknown };
  if (typeof data.request_id !== "string" || !data.request_id) throw new Error("MUREKA_REQUEST_ID_MISSING");
  return data.request_id;
}
/** Poll only an already persisted request ID. */
export async function checkMurekaSong(requestId: string): Promise<"IN_QUEUE" | "IN_PROGRESS" | "COMPLETED"> {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new Error("MUREKA_REQUEST_ID_INVALID");
  const response = await fetch(`https://queue.fal.run/${MUREKA_SONG_MODEL}/requests/${requestId}/status`, {
    headers: falHeaders(), signal: AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`MUREKA_STATUS_HTTP_${response.status}`);
  const data = await response.json() as { status?: unknown };
  if (data.status !== "IN_QUEUE" && data.status !== "IN_PROGRESS" && data.status !== "COMPLETED") {
    throw new Error("MUREKA_UNKNOWN_STATUS");
  }
  return data.status;
}
export async function fetchMurekaSongResult(requestId: string): Promise<MurekaSongResult> {
  if (!/^[a-zA-Z0-9_-]{8,128}$/.test(requestId)) throw new Error("MUREKA_REQUEST_ID_INVALID");
  const response = await fetch(`https://queue.fal.run/${MUREKA_SONG_MODEL}/requests/${requestId}`, {
    headers: falHeaders(), signal: AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`MUREKA_RESULT_HTTP_${response.status}`);
  return parseMurekaSongResult(await response.json());
}
