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

/** Server-only private read. Callers MUST verify the job owner in Neon first. */
export async function fetchOwnedPrivateVideoAsset(
  storageKey: string, ownerId: string, jobId: string, range?: string,
): Promise<Response> {
  if (!validatePrivateVideoAssetKey(storageKey, ownerId, jobId)) throw new Error("VIDEO_ASSET_KEY_FORBIDDEN");
  const config = videoStorageConfig();
  if (!config) throw new Error("VIDEO_STORAGE_NOT_CONFIGURED");
  const endpoint = new URL(`/storage/v1/object/authenticated/${encodeURIComponent(config.bucket)}/${storageKey}`, config.url);
  const headers: Record<string,string> = {
    Authorization: `Bearer ${config.serviceKey}`, apikey: config.serviceKey,
  };
  if (range && /^bytes=\d*-\d*$/.test(range)) headers.Range = range;
  const response = await fetch(endpoint, { headers, redirect:"error", signal:AbortSignal.timeout(45_000) });
  if (!response.ok && response.status !== 206) throw new Error("VIDEO_STORAGE_FETCH_FAILED");
  const mime = (response.headers.get("content-type") || "").split(";")[0].toLowerCase();
  if (!VIDEO_MIME.includes(mime as VideoMime)) throw new Error("VIDEO_STORAGE_MIME_INVALID");
  return response;
}

/** Persist already-produced bytes; called only after an authorized completed job.
 * No provider generation is performed here. The caller must verify job ownership.
 */
export async function storeCompletedPrivateVideoAsset(
  ownerId: string, jobId: string, mime: VideoMime, bytes: Buffer,
): Promise<{storageKey:string;size:number;mimeType:VideoMime}> {
  const storageKey = videoPrivateAssetKey(ownerId,jobId,mime);
  const limit = mime === "image/gif" ? VIDEO_PRIVATE_STORAGE_LIMITS.maxGifBytes : VIDEO_PRIVATE_STORAGE_LIMITS.maxVideoBytes;
  if (!Buffer.isBuffer(bytes) || bytes.length === 0 || bytes.length > limit) throw new Error("VIDEO_ASSET_SIZE_INVALID");
  const config = videoStorageConfig();
  if (!config) throw new Error("VIDEO_STORAGE_NOT_CONFIGURED");
  const endpoint = new URL(`/storage/v1/object/${encodeURIComponent(config.bucket)}/${storageKey}`,config.url);
  const response = await fetch(endpoint,{
    method:"POST",redirect:"error",
    headers:{Authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey,
      "Content-Type":mime,"x-upsert":"false"},
    body:bytes,signal:AbortSignal.timeout(60_000),
  });
  if (!response.ok) throw new Error("VIDEO_PRIVATE_UPLOAD_FAILED");
  return {storageKey,size:bytes.length,mimeType:mime};
}

/** Verify the bucket exists and is private. Read-only; never creates buckets. */
export async function inspectVideoPrivateBucket(): Promise<{
  configured:boolean; verified:boolean; privateBucket:boolean;
}> {
  const config=videoStorageConfig();
  if(!config) return {configured:false,verified:false,privateBucket:false};
  try {
    const endpoint=new URL(`/storage/v1/bucket/${encodeURIComponent(config.bucket)}`,config.url);
    const response=await fetch(endpoint,{
      headers:{Authorization:`Bearer ${config.serviceKey}`,apikey:config.serviceKey},
      redirect:"error",signal:AbortSignal.timeout(8_000),
    });
    if(!response.ok) return {configured:true,verified:false,privateBucket:false};
    const data:unknown=await response.json();
    if(!data || typeof data!=="object" || !("public" in data)) return {configured:true,verified:false,privateBucket:false};
    return {configured:true,verified:true,privateBucket:(data as {public:unknown}).public===false};
  }catch{return {configured:true,verified:false,privateBucket:false};}
}
