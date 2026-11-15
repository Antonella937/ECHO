import assert from "node:assert/strict";
import test from "node:test";
import { fetchMpPaymentEvidence, validateMpPaymentEvidence } from "../src/lib/mercadopagoPaymentEvidence";

test("payment lookup rejects invalid IDs before network access", async () => {
  await assert.rejects(fetchMpPaymentEvidence("../secrets"), /INVALID_MP_PAYMENT_ID/);
});
test("payment lookup requires sandbox credentials", async () => {
  const old = process.env.ECHO_MP_ACCESS_TOKEN;
  delete process.env.ECHO_MP_ACCESS_TOKEN;
  try {
    await assert.rejects(fetchMpPaymentEvidence("12345"), /MP_TEST_CREDENTIALS_UNAVAILABLE/);
  } finally {
    if (old !== undefined) process.env.ECHO_MP_ACCESS_TOKEN = old;
  }
});
test("provider response is validated against the requested payment ID", async () => {
  const oldToken = process.env.ECHO_MP_ACCESS_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.ECHO_MP_ACCESS_TOKEN = "TEST-unit-test";
  globalThis.fetch = async () => new Response(JSON.stringify({ id: 987, status: "approved" }), { status: 200 });
  try {
    await assert.rejects(fetchMpPaymentEvidence("123"), /MP_PAYMENT_ID_MISMATCH/);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.ECHO_MP_ACCESS_TOKEN;
    else process.env.ECHO_MP_ACCESS_TOKEN = oldToken;
  }
});
test("provider-approved response still needs reference and amount validation", async () => {
  const oldToken = process.env.ECHO_MP_ACCESS_TOKEN;
  const oldFetch = globalThis.fetch;
  process.env.ECHO_MP_ACCESS_TOKEN = "TEST-unit-test";
  globalThis.fetch = async () => new Response(JSON.stringify({
    id: 123, status: "approved", external_reference: "different",
    transaction_amount: 1500, currency_id: "ARS", date_approved: "2026-11-01T12:00:00Z",
  }), { status: 200 });
  try {
    const payment = await fetchMpPaymentEvidence("123");
    assert.equal(validateMpPaymentEvidence({ payment, reference: "echo:plus:correct", amountArs: 1500 }).accepted, false);
  } finally {
    globalThis.fetch = oldFetch;
    if (oldToken === undefined) delete process.env.ECHO_MP_ACCESS_TOKEN;
    else process.env.ECHO_MP_ACCESS_TOKEN = oldToken;
  }
});
