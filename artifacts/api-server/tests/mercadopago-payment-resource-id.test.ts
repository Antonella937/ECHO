import assert from "node:assert/strict";
import test from "node:test";
import { normalizeMpPaymentResourceId } from "../src/lib/mercadopagoPaymentEvidence";

test("normalizes decimal payment IDs from webhook JSON", () => {
  assert.equal(normalizeMpPaymentResourceId("12345"), "12345");
  assert.equal(normalizeMpPaymentResourceId(12345), "12345");
});
test("rejects unsafe, fractional, negative and structured IDs", () => {
  for (const id of [-1, 1.5, Number.MAX_SAFE_INTEGER + 1, "1/2", "abc", {}, null]) {
    assert.equal(normalizeMpPaymentResourceId(id), null);
  }
});
