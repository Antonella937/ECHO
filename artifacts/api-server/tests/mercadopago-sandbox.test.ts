import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import { buildMpPreapprovalPayload } from "../src/lib/mercadopagoSubscriptions";
import { verifyMpWebhookSignature } from "../src/lib/mercadopagoWebhookSignature";

const reference = "echo:plus:123e4567-e89b-42d3-a456-426614174000";
const base = {
  reference,
  plan: "plus" as const,
  amountArs: 1500,
  payerEmail: "buyer@example.com",
  backUrl: "https://echoverse.pages.dev/billing/return",
};

test("subscription payload uses server-side ARS monthly amount and external reference", () => {
  const payload = buildMpPreapprovalPayload(base);
  assert.equal(payload.external_reference, reference);
  assert.equal(payload.auto_recurring.currency_id, "ARS");
  assert.equal(payload.auto_recurring.transaction_amount, 1500);
  assert.equal(payload.auto_recurring.frequency_type, "months");
  assert.equal(payload.auto_recurring.frequency, 1);
});

test("subscription payload rejects invalid reference, amount and callback", () => {
  assert.throws(() => buildMpPreapprovalPayload({ ...base, reference: "fake" }));
  assert.throws(() => buildMpPreapprovalPayload({ ...base, amountArs: 0 }));
  assert.throws(() => buildMpPreapprovalPayload({ ...base, backUrl: "http://example.com" }));
  assert.throws(() => buildMpPreapprovalPayload({ ...base, payerEmail: "invalid" }));
});

test("webhook signature requires authentic HMAC and rejects tampering or replay", () => {
  const secret = "sandbox-secret";
  const requestId = "request-123";
  const dataId = "123456";
  const nowMs = 1794780000000;
  const ts = String(Math.floor(nowMs / 1000));
  const manifest = `id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1 = createHmac("sha256", secret).update(manifest).digest("hex");
  const signature = `ts=${ts},v1=${v1}`;
  assert.equal(verifyMpWebhookSignature({ signature, requestId, dataId, secret, nowMs }), true);
  assert.equal(verifyMpWebhookSignature({ signature, requestId: "different", dataId, secret, nowMs }), false);
  assert.equal(verifyMpWebhookSignature({ signature, requestId, dataId, secret, nowMs: nowMs + 360000 }), false);
  assert.equal(verifyMpWebhookSignature({ signature, requestId, dataId, secret: "wrong", nowMs }), false);
});
