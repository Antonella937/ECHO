/** Server-only generated-music ingestion into a private Supabase Storage bucket.
 * Do not return service-role credentials or upstream provider URLs to clients.
 * This module does not initiate generation or spend credits.
 */
import { randomUUID } from "node:crypto";

const MAX_AUDIO_BYTES = 30 * 1024 * 1024;
const MIME_TYPES = new Set(["audio/mpeg", "audio/mp3", "audio/wav", "audio/x-wav", "audio/mp4", "audio/aac", "audio/ogg"]);
const FAL_HOSTS = ["fal.media", "fal.ai", "fal.run"];

function providerUrl(raw: string): URL {
  const url = new URL(raw);
  if (url.protocol !== "https:" || url.username || url.password || url.port !== "") {
    throw new Error("MUSIC_PROVIDER_URL_INVALID");
  }
  if (!FAL_HOSTS.some(host => url.hostname === host || url.hostname.endsWith("." + host))) {
    throw new Error("MUSIC_PROVIDER_HOST_UNTRUSTED");
  }
  return url;
}
function storageConfig() {
  const base = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  // Reuse the existing private ECHO media bucket unless explicitly overridden.
  const bucket = process.env.ECHO_MUSIC_STORAGE_BUCKET?.trim() || "echo-media";
  if (!base || !key || !bucket || !/^[a-zA-Z0-9_-]{1,80}$/.test(bucket)) {
    throw new Error("MUSIC_PRIVATE_STORAGE_NOT_CONFIGURED");
  }
  const url = new URL(base);
  if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname)) {
    throw new Error("MUSIC_SUPABASE_URL_INVALID");
  }
  return { url, key, bucket };
}
/** Requires the caller to validate a completed Neon job before invocation.
 * Returns a private storage key, not a publicly accessible URL.
 */
export async function ingestGeneratedMusic(
  sourceUrl: string, ownerId: string, jobId: string,
): Promise<{ storageKey: string; mimeType: string; size: number }> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId) || !/^[a-f0-9-]{36}$/i.test(jobId)) {
    throw new Error("MUSIC_STORAGE_IDENTIFIERS_INVALID");
  }
  const source = providerUrl(sourceUrl);
  const { url, key, bucket } = storageConfig();
  const download = await fetch(source, { redirect: "error", signal: AbortSignal.timeout(45_000) });
  if (!download.ok) throw new Error(`MUSIC_DOWNLOAD_HTTP_${download.status}`);
  const declaredLength = Number(download.headers.get("content-length") || 0);
  if (declaredLength > MAX_AUDIO_BYTES) throw new Error("MUSIC_AUDIO_TOO_LARGE");
  const mimeType = (download.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!MIME_TYPES.has(mimeType)) throw new Error("MUSIC_AUDIO_TYPE_INVALID");
  // Bound the actual streamed bytes even when Content-Length is absent or forged.
  const reader = download.body?.getReader();
  if (!reader) throw new Error("MUSIC_AUDIO_EMPTY");
  const chunks: Uint8Array[] = [];
  let size = 0;
  try {
    while (true) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_AUDIO_BYTES) {
        await reader.cancel();
        throw new Error("MUSIC_AUDIO_TOO_LARGE");
      }
      chunks.push(value);
    }
  } finally { reader.releaseLock(); }
  if (!size) throw new Error("MUSIC_AUDIO_EMPTY");
  const bytes = Buffer.concat(chunks.map(chunk => Buffer.from(chunk)));
  const ext = mimeType === "audio/mpeg" || mimeType === "audio/mp3" ? "mp3"
    : mimeType === "audio/wav" || mimeType === "audio/x-wav" ? "wav"
    : mimeType === "audio/ogg" ? "ogg" : mimeType === "audio/aac" ? "aac" : "m4a";
  const storageKey = `generated/${ownerId}/${jobId}/${randomUUID()}.${ext}`;
  const endpoint = new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${storageKey}`, url);
  const upload = await fetch(endpoint, {
    method: "POST",
    headers: { Authorization: `Bearer ${key}`, apikey: key, "Content-Type": mimeType, "x-upsert": "false" },
    body: bytes,
    signal: AbortSignal.timeout(45_000),
  });
  if (!upload.ok) throw new Error(`MUSIC_PRIVATE_UPLOAD_HTTP_${upload.status}`);
  return { storageKey, mimeType, size };
}

/** Download an already-ingested private track. The route MUST verify ownership
 * against Neon before calling this function. Never return the service key.
 */
export async function fetchPrivateGeneratedMusic(storageKey: string, range?: string) {
  if (!/^generated\/[a-zA-Z0-9_-]{1,128}\/[a-f0-9-]{36}\/[a-f0-9-]{36}\.(mp3|wav|ogg|aac|m4a)$/i.test(storageKey)) {
    throw new Error("MUSIC_STORAGE_KEY_INVALID");
  }
  const { url, key, bucket } = storageConfig();
  const endpoint = new URL(`/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${storageKey}`, url);
  const headers: Record<string, string> = { Authorization: `Bearer ${key}`, apikey: key };
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  const response = await fetch(endpoint, {
    headers, redirect: "error", signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok && response.status !== 206) throw new Error(`MUSIC_PRIVATE_DOWNLOAD_HTTP_${response.status}`);
  const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!MIME_TYPES.has(mime)) throw new Error("MUSIC_PRIVATE_AUDIO_TYPE_INVALID");
  return response;
}
