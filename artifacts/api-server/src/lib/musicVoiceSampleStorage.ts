/** Private vocal sample staging. No paid provider calls. */
import { randomUUID } from "node:crypto";
const MAX_BYTES = 10 * 1024 * 1024;
function config() {
  const raw = process.env.SUPABASE_URL?.trim();
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const bucket = process.env.ECHO_MUSIC_STORAGE_BUCKET?.trim() || "echo-media";
  if (!raw || !key || !/^[a-zA-Z0-9_-]{1,80}$/.test(bucket)) throw new Error("VOICE_STORAGE_NOT_CONFIGURED");
  const base = new URL(raw);
  if (base.protocol !== "https:" || !/^[a-z0-9-]+\.supabase\.co$/.test(base.hostname)) throw new Error("VOICE_STORAGE_HOST_INVALID");
  return {base,key,bucket};
}
export function validateVocalSampleBytes(bytes: Buffer, mime: string): void {
  if (!bytes.length || bytes.length >= MAX_BYTES) throw new Error("VOICE_SAMPLE_SIZE_INVALID");
  const mp3 = mime === "audio/mpeg" || mime === "audio/mp3";
  const m4a = mime === "audio/mp4" || mime === "audio/x-m4a";
  if (!mp3 && !m4a) throw new Error("VOICE_SAMPLE_TYPE_INVALID");
  if (mp3 && !(bytes.subarray(0,3).toString("ascii")==="ID3" || (bytes[0]===0xff && (bytes[1]&0xe0)===0xe0))) throw new Error("VOICE_SAMPLE_HEADER_INVALID");
  if (m4a && bytes.subarray(4,8).toString("ascii")!=="ftyp") throw new Error("VOICE_SAMPLE_HEADER_INVALID");
}
export async function storePrivateVocalSample(ownerId:string, characterId:string, bytes:Buffer, mime:string) {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(characterId)) throw new Error("VOICE_SAMPLE_OWNER_INVALID");
  validateVocalSampleBytes(bytes,mime);
  const {base,key,bucket}=config();
  const extension = mime === "audio/mpeg" || mime === "audio/mp3" ? "mp3" : "m4a";
  const storageKey = `voice-samples/${ownerId}/${characterId}/${randomUUID()}.${extension}`;
  const endpoint = new URL(`/storage/v1/object/${encodeURIComponent(bucket)}/${storageKey}`,base);
  const response = await fetch(endpoint,{method:"POST",headers:{Authorization:`Bearer ${key}`,apikey:key,"Content-Type":mime,"x-upsert":"false"},body:bytes,signal:AbortSignal.timeout(45000)});
  if (!response.ok) throw new Error(`VOICE_SAMPLE_UPLOAD_HTTP_${response.status}`);
  return {storageKey,size:bytes.length,mimeType:mime};
}
export async function fetchOwnedPrivateVocalSample(ownerId:string,characterId:string,storageKey:string):Promise<{bytes:Buffer;mimeType:string}> {
  if (!/^[a-zA-Z0-9_-]{1,128}$/.test(ownerId) || !/^[a-zA-Z0-9_-]{1,128}$/.test(characterId)) throw new Error("VOICE_SAMPLE_OWNER_INVALID");
  if (!storageKey.startsWith(`voice-samples/${ownerId}/${characterId}/`) || !/^voice-samples\/[a-zA-Z0-9_-]{1,128}\/[a-zA-Z0-9_-]{1,128}\/[a-f0-9-]{36}\.(mp3|m4a)$/.test(storageKey)) throw new Error("VOICE_SAMPLE_ACCESS_DENIED");
  const {base,key,bucket}=config();
  const endpoint = new URL(`/storage/v1/object/authenticated/${encodeURIComponent(bucket)}/${storageKey}`,base);
  const response = await fetch(endpoint,{headers:{Authorization:`Bearer ${key}`,apikey:key},signal:AbortSignal.timeout(30000)});
  if (!response.ok) throw new Error("VOICE_SAMPLE_NOT_FOUND");
  const declared=Number(response.headers.get("content-length")||0);
  if (declared>=MAX_BYTES) throw new Error("VOICE_SAMPLE_SIZE_INVALID");
  const bytes=Buffer.from(await response.arrayBuffer());
  const mimeType=storageKey.endsWith(".mp3")?"audio/mpeg":"audio/mp4";
  validateVocalSampleBytes(bytes,mimeType);
  return {bytes,mimeType};
}
