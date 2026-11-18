import assert from "node:assert/strict";
import test from "node:test";
import { validateMpSubscriptionBinding, type VerifiedMpPayment } from "../src/lib/mercadopagoPaymentEvidence";

const payment: VerifiedMpPayment = {
  id: "123", status: "approved", externalReference: "echo:plus:reference",
  transactionAmount: 1500, currencyId: "ARS",
  dateApproved: "2026-11-01T12:00:00Z", subscriptionId: "preapproval-123",
};

test("only a matching provider preapproval ID binds a payment", () => {
  assert.equal(validateMpSubscriptionBinding(payment, "preapproval-123").accepted, true);
  assert.equal(validateMpSubscriptionBinding(payment, "other").accepted, false);
});
test("missing subscription binding is rejected even when reference matches", () => {
  assert.equal(validateMpSubscriptionBinding({ ...payment, subscriptionId: null }, "preapproval-123").accepted, false);
  assert.equal(validateMpSubscriptionBinding(payment, "").accepted, false);
});
