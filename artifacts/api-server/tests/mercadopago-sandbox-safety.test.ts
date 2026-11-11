import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import { test } from "node:test";
import { buildMpPreapprovalPayload, createMpSandboxPreapproval, fetchMpSandboxPayment, fetchMpPreapproval, matchesMpSandboxPayer } from "../src/lib/mercadopagoSubscriptions";
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
test("sandbox callback rejects local addresses, embedded credentials and fragments", () => {
  for (const backUrl of [
    "https://localhost/subscriptions",
    "https://127.0.0.1/subscriptions",
    "https://internal.local/subscriptions",
    "https://user:pass@echoverse.pages.dev/subscriptions",
    "https://echoverse.pages.dev/subscriptions#token",
    "https://[::1]/subscriptions",
  ]) {
    assert.throws(() => buildMpPreapprovalPayload({ ...valid, backUrl }), backUrl);
  }
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

test("sandbox checkout is disabled by default and makes no provider calls", async () => {
  let calls = 0;
  const original = process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED;
  delete process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED;
  try {
    await assert.rejects(createMpSandboxPreapproval(valid, {
      sandboxEnabled: true,
      fetchImpl: (async () => { calls++; throw Error("SHOULD_NOT_CALL_PROVIDER"); }) as typeof fetch,
    }), /MP_SANDBOX_CHECKOUT_DISABLED/);
    assert.equal(calls, 0);
  } finally {
    if (original === undefined) delete process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED;
    else process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED = original;
  }
});
test("sandbox checkout rejects production credentials before network", async () => {
  const oldFlag = process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED;
  const oldToken = process.env.ECHO_MP_ACCESS_TOKEN;
  process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED = "true";
  process.env.ECHO_MP_ACCESS_TOKEN = "APP_USR_production";
  let calls = 0;
  try {
    await assert.rejects(createMpSandboxPreapproval(valid, {
      sandboxEnabled: true,
      fetchImpl: (async () => { calls++; throw Error("SHOULD_NOT_CALL_PROVIDER"); }) as typeof fetch,
    }), /MP_TEST_CREDENTIALS_UNAVAILABLE/);
    assert.equal(calls, 0);
  } finally {
    if (oldFlag === undefined) delete process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED;
    else process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED = oldFlag;
    if (oldToken === undefined) delete process.env.ECHO_MP_ACCESS_TOKEN;
    else process.env.ECHO_MP_ACCESS_TOKEN = oldToken;
  }
});

test("sandbox provider response must match reference and trusted checkout host", async () => {
  const oldFlag = process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED;
  const oldToken = process.env.ECHO_MP_ACCESS_TOKEN;
  process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED = "true";
  process.env.ECHO_MP_ACCESS_TOKEN = "TEST-offline-fixture";
  const provider = (payload: Record<string, unknown>) => (async (_url: string | URL | Request, init?: RequestInit) => {
    assert.equal(init?.method, "POST");
    assert.equal((init?.headers as Record<string, string>)["X-Idempotency-Key"], reference);
    return { ok: true, json: async () => payload } as Response;
  }) as typeof fetch;
  try {
    const accepted = await createMpSandboxPreapproval(valid, { sandboxEnabled: true, fetchImpl: provider({
      id: "sandbox-123", init_point: "https://www.mercadopago.com.ar/checkout/test",
      external_reference: reference, status: "pending",
    }) });
    assert.equal(accepted.id, "sandbox-123");
    assert.equal(accepted.status, "pending");
    for (const bad of [
      { id: "sandbox-123", init_point: "https://evil.example/checkout", external_reference: reference, status: "pending" },
      { id: "sandbox-123", init_point: "https://www.mercadopago.com.ar/checkout/test", external_reference: "another-reference", status: "pending" },
      { id: "sandbox-123", init_point: "http://www.mercadopago.com.ar/checkout/test", external_reference: reference, status: "pending" },
    ]) {
      await assert.rejects(createMpSandboxPreapproval(valid, { sandboxEnabled: true, fetchImpl: provider(bad) }), /INVALID_MP_/);
    }
  } finally {
    if (oldFlag === undefined) delete process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED;
    else process.env.ECHO_MP_SANDBOX_CHECKOUT_ENABLED = oldFlag;
    if (oldToken === undefined) delete process.env.ECHO_MP_ACCESS_TOKEN;
    else process.env.ECHO_MP_ACCESS_TOKEN = oldToken;
  }
});

test("sandbox payment verification reads provider data without granting access", async () => {
  const previous = process.env.ECHO_MP_ACCESS_TOKEN;
  process.env.ECHO_MP_ACCESS_TOKEN = "TEST-offline-fixture";
  let calls = 0;
  const fakeFetch = (async (url: string | URL | Request, init?: RequestInit) => {
    calls++;
    assert.equal(String(url), "https://api.mercadopago.com/v1/payments/123");
    assert.equal(init?.method, "GET");
    return new Response(JSON.stringify({
      id: 123, status: "approved", transaction_amount: 1200, currency_id: "ARS",
      point_of_interaction: { subscription_id: "preapproval-123" },
    }), { status: 200 });
  }) as typeof fetch;
  try {
    const payment = await fetchMpSandboxPayment("123", { fetchImpl: fakeFetch });
    assert.deepEqual(payment, {
      id: "123", status: "approved", amountArs: 1200,
      currency: "ARS", subscriptionId: "preapproval-123",
    });
    assert.equal(calls, 1);
    await assert.rejects(fetchMpSandboxPayment("../123", { fetchImpl: fakeFetch }), /INVALID_MP_RESOURCE_ID/);
    assert.equal(calls, 1);
    await assert.rejects(fetchMpSandboxPayment("123", {
      fetchImpl: (async () => new Response(JSON.stringify({ id: 999, status: "approved" }), { status: 200 })) as typeof fetch,
    }), /MP_PAYMENT_ID_MISMATCH/);
    const reversed = await fetchMpSandboxPayment("123", {
      fetchImpl: (async () => new Response(JSON.stringify({
        id: 123, status: "refunded", transaction_amount: 1200, currency_id: "ARS",
      }), { status: 200 })) as typeof fetch,
    });
    assert.equal(reversed.status, "refunded");
    assert.equal(reversed.subscriptionId, null);
  } finally {
    if (previous === undefined) delete process.env.ECHO_MP_ACCESS_TOKEN;
    else process.env.ECHO_MP_ACCESS_TOKEN = previous;
  }
});

test("sandbox payer identity fails closed on missing, malformed or different email", () => {
  assert.equal(matchesMpSandboxPayer("Buyer@Example.com", "buyer@example.com"), true);
  assert.equal(matchesMpSandboxPayer(" buyer@example.com ", "BUYER@example.com"), true);
  assert.equal(matchesMpSandboxPayer("other@example.com", "buyer@example.com"), false);
  assert.equal(matchesMpSandboxPayer(null, "buyer@example.com"), false);
  assert.equal(matchesMpSandboxPayer("buyer@example.com", undefined), false);
  assert.equal(matchesMpSandboxPayer("not-an-email", "not-an-email"), false);
});

test("provider preapproval read normalizes authoritative subscription identity and amount", async () => {
  const previous = process.env.ECHO_MP_ACCESS_TOKEN;
  process.env.ECHO_MP_ACCESS_TOKEN = "TEST-offline-token";
  try {
    let calls = 0;
    const fetchImpl = (async (url: string | URL | Request) => {
      calls++;
      assert.equal(String(url), "https://api.mercadopago.com/preapproval/sub_123");
      return new Response(JSON.stringify({
        id: "sub_123", status: "authorized", external_reference: reference,
        payer_email: "buyer@example.com", next_payment_date: "2026-12-11T00:00:00Z",
        auto_recurring: { transaction_amount: 1200 },
      }), { status: 200 });
    }) as typeof fetch;
    const item = await fetchMpPreapproval("sub_123", { fetchImpl });
    assert.equal(calls, 1);
    assert.equal(item.id, "sub_123");
    assert.equal(item.status, "authorized");
    assert.equal(item.externalReference, reference);
    assert.equal(item.payerEmail, "buyer@example.com");
    assert.equal(item.amountArs, 1200);
    await assert.rejects(() => fetchMpPreapproval("../unsafe", { fetchImpl }), /INVALID_MP_RESOURCE_ID/);
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.ECHO_MP_ACCESS_TOKEN;
    else process.env.ECHO_MP_ACCESS_TOKEN = previous;
  }
});
