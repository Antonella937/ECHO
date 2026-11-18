import assert from "node:assert/strict";
import test from "node:test";
import { decideMpSubscriptionTransition } from "../src/lib/mercadopagoReconciliation";
import type { MpPreapproval } from "../src/lib/mercadopagoSubscriptions";

const intent = { reference: "echo:plus:123e4567-e89b-42d3-a456-426614174000", providerPreapprovalId: "mp123", amountArs: 1500 };
const provider: MpPreapproval = { id: "mp123", status: "authorized", externalReference: intent.reference, payerEmail: null, nextPaymentDate: null, amountArs: 1500 };

test("authorization never grants entitlements without confirmed collection", () => {
  assert.equal(decideMpSubscriptionTransition({ intent, provider }).action, "pending");
});
test("mismatched reference, provider ID and amount are rejected", () => {
  for (const changed of [
    { ...provider, externalReference: "other" },
    { ...provider, id: "other" },
    { ...provider, amountArs: 999 },
  ]) assert.equal(decideMpSubscriptionTransition({ intent, provider: changed }).action, "ignore");
});
test("cancellation requires paid-through review before revoking", () => {
  assert.equal(decideMpSubscriptionTransition({ intent, provider: { ...provider, status: "cancelled" } }).action, "suspend");
});
test("unknown status is fail-closed", () => {
  assert.equal(decideMpSubscriptionTransition({ intent, provider: { ...provider, status: "unknown" } }).action, "ignore");
});
