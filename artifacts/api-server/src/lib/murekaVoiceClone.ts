/** Server-only Mureka voice-clone transport (fal.ai).
 * This module does not authorize spending. Callers MUST verify consent,
 * entitlement, budget reservation, and explicit charge confirmation before
 * invoking submitMurekaVoiceClone. Never expose FAL_KEY to a browser.
 *
 * Provider schema: https://fal.ai/models/mureka/api/voice/clone/api
 */
export const MUREKA_VOICE_CLONE_MODEL = "mureka/api/voice/clone" as const;
// fal queue status and result URLs use the owner/app namespace.
const QUEUE_APP = MUREKA_VOICE_CLONE_MODEL.split("/").slice(0, 2).join("/");
const REQUEST_ID = /^[a-zA-Z0-9_-]{8,128}$/;
const VOCAL_ID = /^[a-zA-Z0-9_-]{1,128}$/;
const AUDIO_DATA_URI = /^data:audio\/(?:mpeg|mp3|mp4|x-m4a);base64,([a-zA-Z0-9+/]+={0,2})$/;

function headers(): Record<string,string> {
  const key = process.env.FAL_KEY?.trim();
  if (!key) throw new Error("FAL_KEY_NOT_CONFIGURED");
  return {Authorization: `Key ${key}`, "Content-Type":"application/json"};
}
/** Audio is private: only server-generated data URIs, never arbitrary URLs. */
export function validateCloneSample(audioUrl: string): void {
  const match = AUDIO_DATA_URI.exec(audioUrl);
  if (!match) throw new Error("VOICE_CLONE_SAMPLE_INVALID");
  const encoded = match[1];
  if (encoded.length % 4 !== 0 || !/^(?:[A-Za-z0-9+/]{4})*(?:[A-Za-z0-9+/]{2}==|[A-Za-z0-9+/]{3}=)?$/.test(encoded)) throw new Error("VOICE_CLONE_SAMPLE_INVALID");
  const estimatedBytes = Math.floor(encoded.length * 3 / 4) - (encoded.endsWith("==") ? 2 : encoded.endsWith("=") ? 1 : 0);
  if (estimatedBytes <= 0 || estimatedBytes >= 10 * 1024 * 1024) throw new Error("VOICE_CLONE_SAMPLE_SIZE_INVALID");
}
export function parseCloneResult(value: unknown): string {
  if (!value || typeof value !== "object") throw new Error("VOICE_CLONE_RESULT_INVALID");
  const outer = value as Record<string,unknown>;
  const result = outer.data && typeof outer.data === "object" ? outer.data as Record<string,unknown> : outer;
  if (typeof result.vocal_id !== "string" || !VOCAL_ID.test(result.vocal_id)) throw new Error("VOICE_CLONE_ID_MISSING");
  return result.vocal_id;
}
/** Billable operation. NEVER call without a durable charge reservation. */
export async function submitMurekaVoiceClone(audioUrl: string, description?: string): Promise<string> {
  validateCloneSample(audioUrl);
  if (description && description.length > 1024) throw new Error("VOICE_CLONE_DESCRIPTION_TOO_LONG");
  const response = await fetch(`https://queue.fal.run/${MUREKA_VOICE_CLONE_MODEL}`,{
    method:"POST",headers:headers(),body:JSON.stringify({audio_url:audioUrl,...(description ? {description}: {})}),
    signal:AbortSignal.timeout(20000),
  });
  if (!response.ok) throw new Error(`VOICE_CLONE_SUBMIT_HTTP_${response.status}`);
  const payload = await response.json() as {request_id?:unknown};
  if (typeof payload.request_id !== "string" || !REQUEST_ID.test(payload.request_id)) throw new Error("VOICE_CLONE_REQUEST_ID_INVALID");
  return payload.request_id;
}
export async function checkMurekaVoiceClone(requestId: string): Promise<"IN_QUEUE"|"IN_PROGRESS"|"COMPLETED"> {
  if (!REQUEST_ID.test(requestId)) throw new Error("VOICE_CLONE_REQUEST_ID_INVALID");
  const response = await fetch(`https://queue.fal.run/${QUEUE_APP}/requests/${requestId}/status`,{
    headers:headers(),signal:AbortSignal.timeout(12000),
  });
  if (!response.ok) throw new Error(`VOICE_CLONE_STATUS_HTTP_${response.status}`);
  const payload = await response.json() as {status?:unknown};
  if (payload.status !== "IN_QUEUE" && payload.status !== "IN_PROGRESS" && payload.status !== "COMPLETED")
    throw new Error("VOICE_CLONE_STATUS_INVALID");
  return payload.status;
}
export async function fetchMurekaVoiceClone(requestId: string): Promise<string> {
  if (!REQUEST_ID.test(requestId)) throw new Error("VOICE_CLONE_REQUEST_ID_INVALID");
  const response = await fetch(`https://queue.fal.run/${QUEUE_APP}/requests/${requestId}`,{
    headers:headers(),signal:AbortSignal.timeout(15000),
  });
  if (!response.ok) throw new Error(`VOICE_CLONE_RESULT_HTTP_${response.status}`);
  return parseCloneResult(await response.json());
}
