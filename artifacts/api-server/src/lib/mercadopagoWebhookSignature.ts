import { createHmac, timingSafeEqual } from "node:crypto";
/** Verify Mercado Pago HMAC; never trust a webhook body as proof of payment. */
export function verifyMpWebhookSignature(input: { signature?: string; requestId?: string; dataId?: string; secret?: string; nowMs?: number }): boolean {
  if (!input.secret || !input.signature || !input.requestId || !input.dataId) return false;
  const parts = Object.fromEntries(input.signature.split(",").map(segment => {
    const index = segment.indexOf("=");
    return index > 0 ? [segment.slice(0,index).trim(),segment.slice(index+1).trim()] : ["",""];
  }));
  if (!parts.ts || !/^\d{10,16}$/.test(parts.ts) || !parts.v1 || !/^[a-f0-9]{64}$/i.test(parts.v1)) return false;
  const timestamp = Number(parts.ts);
  const millis = timestamp < 1e12 ? timestamp * 1000 : timestamp;
  if (!Number.isFinite(millis) || Math.abs((input.nowMs ?? Date.now()) - millis) > 300000) return false;
  if (!/^[A-Za-z0-9_-]{1,256}$/.test(input.requestId) || !/^[A-Za-z0-9_-]{1,128}$/.test(input.dataId)) return false;
  const manifest = `id:${input.dataId.toLowerCase()};request-id:${input.requestId};ts:${parts.ts};`;
  const expected = createHmac("sha256",input.secret).update(manifest).digest();
  const actual = Buffer.from(parts.v1,"hex");
  return expected.length === actual.length && timingSafeEqual(expected,actual);
}
