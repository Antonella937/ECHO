import test from "node:test";
import assert from "node:assert/strict";
import { screenTrustEvidence } from "../src/lib/relationshipTrustCandidates";

test("screens explicit statements without declaring them true", () => {
  assert.deepEqual(screenTrustEvidence("Te mentí"), { eligible: true, reason: "REVIEW_REQUIRED" });
  assert.equal(screenTrustEvidence("No te mentí").reason, "NEGATED");
  assert.equal(screenTrustEvidence("I never lied").reason, "NEGATED");
  assert.equal(screenTrustEvidence("Si te traicioné, ¿qué harías?").reason, "HYPOTHETICAL");
  assert.equal(screenTrustEvidence("Te mentí jajaja").reason, "JOKE_OR_RETRACTION");
  assert.equal(screenTrustEvidence('“Te mentí”').reason, "QUOTED_OR_REPORTED");
});
