import assert from "node:assert/strict";
import { test } from "node:test";
import { canActivatePaidMembership, nextMpSubscriptionStatus } from "../src/lib/mercadopagoReconciliationPolicy";

test("preapproval status transitions do not imply paid access", () => {
  assert.equal(nextMpSubscriptionStatus("draft", "authorized"), "authorized");
  assert.equal(nextMpSubscriptionStatus("authorized", "paused"), "paused");
  assert.equal(nextMpSubscriptionStatus("authorized", "cancelled"), "canceled");
  assert.equal(nextMpSubscriptionStatus("canceled", "authorized"), "canceled");
  assert.equal(nextMpSubscriptionStatus("pending", "unknown"), "pending");
});
test("paid membership requires separately verified approved payment and future period", () => {
  const now = new Date("2026-11-11T12:00:00Z");
  const valid = { subscriptionStatus:"authorized" as const, paymentStatus:"approved" as const,
    paymentVerifiedFromProvider:true, paymentMatchesSubscription:true, periodEnd:new Date("2026-12-11T12:00:00Z") };
  assert.equal(canActivatePaidMembership(valid,now),true);
  assert.equal(canActivatePaidMembership({...valid,paymentVerifiedFromProvider:false},now),false);
  assert.equal(canActivatePaidMembership({...valid,paymentMatchesSubscription:false},now),false);
  assert.equal(canActivatePaidMembership({...valid,paymentStatus:"pending"},now),false);
  assert.equal(canActivatePaidMembership({...valid,paymentStatus:"refunded"},now),false);
  assert.equal(canActivatePaidMembership({...valid,subscriptionStatus:"paused"},now),false);
  assert.equal(canActivatePaidMembership({...valid,periodEnd:new Date("2026-11-10T12:00:00Z")},now),false);
  assert.equal(canActivatePaidMembership({...valid,periodEnd:null},now),false);
});
