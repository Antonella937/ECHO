import assert from "node:assert/strict";
import test from "node:test";
import { validateMpPaymentEvidence } from "../src/lib/mercadopagoPaymentEvidence";
const payment = {
  id: "12345", status: "approved", externalReference: "echo:plus:ref",
  transactionAmount: 1500, currencyId: "ARS",
  dateApproved: "2026-11-01T12:00:00Z",
};
const input = { payment, reference: "echo:plus:ref", amountArs: 1500 };
test("accepts correctly matched provider-confirmed approved payment", () => {
  assert.equal(validateMpPaymentEvidence(input).accepted, true);
});
test("never grants for pending, wrong currency, amount or reference", () => {
  for (const changed of [
    { ...payment, status: "pending" },
    { ...payment, currencyId: "USD" },
    { ...payment, transactionAmount: 1400 },
    { ...payment, externalReference: "other" },
    { ...payment, dateApproved: null },
  ]) assert.equal(validateMpPaymentEvidence({ ...input, payment: changed }).accepted, false);
});
