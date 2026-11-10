/** Private ECHO Video/GIF storage configuration and key validation.
 * Preparation only: never uploads, downloads, generates or charges.
 */
const VIDEO_MIME = ["video/mp4", "video/webm", "image/gif"] as const;
export type VideoMime = typeof VIDEO_MIME[number];
export function videoStorageConfig() {
  const raw = process.env.SUPABASE_URL?.trim();
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.ECHO_VIDEO_STORAGE_BUCKET?.trim() || "echo-media";
  if (!raw || !serviceKey || !/^[a-zA-Z0-9_-]{1,80}$/.test(bucket)) return null;
  try {
    const url = new URL(raw);
    if (url.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(url.hostname) || url.username || url.password) return null;
    return { url, serviceKey, bucket };
  } catch { return null; }
}
export function videoPrivateAssetKey(ownerId: string, jobId: string, mime: VideoMime) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId) || !/^[a-f0-9-]{36}$/i.test(jobId)) throw new Error("VIDEO_ASSET_ID_INVALID");
  if (!VIDEO_MIME.includes(mime)) throw new Error("VIDEO_ASSET_MIME_INVALID");
  const extension = mime === "video/mp4" ? "mp4" : mime === "video/webm" ? "webm" : "gif";
  return `video/generated/${ownerId}/${jobId}/result.${extension}`;
}
export function validatePrivateVideoAssetKey(key: string, ownerId: string, jobId: string) {
  return /^[a-zA-Z0-9_-]{1,128}$/.test(ownerId)
    && /^[a-f0-9-]{36}$/i.test(jobId)
    && ["mp4","webm","gif"].some(ext => key === `video/generated/${ownerId}/${jobId}/result.${ext}`);
}
export const VIDEO_PRIVATE_STORAGE_LIMITS = Object.freeze({
  maxVideoBytes: 100 * 1024 * 1024,
  maxGifBytes: 25 * 1024 * 1024,
  acceptedMimeTypes: VIDEO_MIME,
  visibility: "private" as const,
  providerCallsEnabled: false,
});
