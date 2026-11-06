import test from "node:test";
import assert from "node:assert/strict";
import { assessTrustContext } from "../src/lib/relationshipTrustContext";
import type { TextProvider } from "../src/ai-engine/contracts";

function fake(text: string): TextProvider {
  return { name: "offline", async complete() { return { text, model: "offline:free" }; } };
}
const evidence = { message: "Te mentí", previousMessages: ["¿Me estás diciendo la verdad?"], relationshipDescription: "Amigos" };

test("AI context can only suggest owner review, never verify a trust event", async () => {
  const result = await assessTrustContext(fake(JSON.stringify({
    status: "suggest_review", kind: "lie_confirmed", rationale: "Possible admission",
  })), evidence);
  assert.equal(result.verified, false);
  assert.equal(result.kind, "lie_confirmed");
});
test("uncertain or joking contexts can be declined", async () => {
  const result = await assessTrustContext(fake(JSON.stringify({
    status: "insufficient_evidence", kind: null, rationale: "Possible joke",
  })), evidence);
  assert.equal(result.status, "insufficient_evidence");
});
test("invalid model claims are rejected rather than applied", async () => {
  await assert.rejects(() => assessTrustContext(fake(JSON.stringify({
    status: "suggest_review", kind: "invented", rationale: "No",
  })), evidence), /INVALID_TRUST_CONTEXT_RESPONSE/);
  await assert.rejects(() => assessTrustContext(fake("not json"), evidence), /INVALID_TRUST_CONTEXT_RESPONSE/);
});
