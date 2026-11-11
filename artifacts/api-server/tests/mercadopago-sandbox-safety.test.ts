import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { buildMpPreapprovalPayload } from "../src/lib/mercadopagoSubscriptions";
import { verifyMpWebhookSignature } from "../src/lib/mercadopagoWebhookSignature";

const reference = "echo:plus:11111111-1111-4111-8111-111111111111";
const valid = {reference, plan:"plus" as const, amountArs:1200, payerEmail:"buyer@example.com", backUrl:"https://echoverse.pages.dev/subscriptions"};

test("subscription payload uses server amount and monthly ARS recurrence",()=>{
  const payload=buildMpPreapprovalPayload(valid);
  assert.equal(payload.external_reference,reference);
  assert.equal(payload.auto_recurring.transaction_amount,1200);
  assert.equal(payload.auto_recurring.currency_id,"ARS");
  assert.equal(payload.auto_recurring.frequency_type,"months");
  assert.equal(payload.auto_recurring.frequency,1);
});
test("rejects invalid amount, payer, reference, or insecure callback",()=>{
  assert.throws(()=>buildMpPreapprovalPayload({...valid,amountArs:0}));
  assert.throws(()=>buildMpPreapprovalPayload({...valid,amountArs:-1}));
  assert.throws(()=>buildMpPreapprovalPayload({...valid,payerEmail:"not-an-email"}));
  assert.throws(()=>buildMpPreapprovalPayload({...valid,reference:"user-provided-reference"}));
  assert.throws(()=>buildMpPreapprovalPayload({...valid,backUrl:"http://echoverse.pages.dev"}));
});
test("webhook signature accepts only correct signed recent manifest",()=>{
  const ts="1794420000";
  const nowMs=Number(ts)*1000;
  const secret="sandbox-test-secret";
  const dataId="123456789";
  const requestId="request-123";
  const manifest=`id:${dataId};request-id:${requestId};ts:${ts};`;
  const v1=createHmac("sha256",secret).update(manifest).digest("hex");
  const signature=`ts=${ts},v1=${v1}`;
  const input={signature,requestId,dataId,secret,nowMs};
  assert.equal(verifyMpWebhookSignature(input),true);
  assert.equal(verifyMpWebhookSignature({...input,requestId:"other-request"}),false);
  assert.equal(verifyMpWebhookSignature({...input,nowMs:nowMs+300001}),false);
  assert.equal(verifyMpWebhookSignature({...input,secret:"wrong-secret"}),false);
  assert.equal(verifyMpWebhookSignature({...input,signature:"ts=invalid,v1=abc"}),false);
});
