import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { applyVerifiedTrustEvent, type VerifiedTrustEvent } from "../src/lib/relationshipTrust";

const now = new Date("2026-11-05T12:00:00Z");
function fixture() {
  const seed = createSeedState();
  const actor = seed.characters.find(c => c.id === "mar")!;
  actor.configuration = defaultCharacterConfig(actor);
  actor.configuration.relationships.push({
    id: "trust-test", targetId: "nela", preset: "friend", customLabel: "",
    description: "", closeness: 40, trust: 50, attraction: null, tension: 0,
    boundaries: "", notes: "",
  } as typeof actor.configuration.relationships[number]);
  return SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state;
}
function event(kind: VerifiedTrustEvent["kind"]): VerifiedTrustEvent {
  return { sourceId: "verified-event-1", actorId: "mar", targetId: "nela",
    kind, occurredAt: new Date("2026-11-04T12:00:00Z"), verified: true };
}
function scores(state: ReturnType<typeof fixture>) {
  return state.characters.find(c => c.id === "mar")!.configuration!.relationships[0];
}
test("verified supportive event changes only directed trust", () => {
  const state = fixture();
  const result = applyVerifiedTrustEvent(state, event("support_given"), { consumedSourceIds: [] }, now);
  assert.equal(result.applied, true);
  assert.equal(result.delta, 2);
  assert.equal(scores(result.state).trust, 52);
  assert.equal(scores(result.state).closeness, 40);
  assert.equal(scores(state).trust, 50);
  assert.equal(result.state.characters.find(c => c.id === "nela")?.configuration, state.characters.find(c => c.id === "nela")?.configuration);
});
test("confirmed betrayal reduces trust, but repeated evidence is rejected", () => {
  const state = fixture();
  assert.equal(scores(applyVerifiedTrustEvent(state, event("betrayal_confirmed"), { consumedSourceIds: [] }, now).state).trust, 42);
  const repeat = applyVerifiedTrustEvent(state, event("betrayal_confirmed"), { consumedSourceIds: ["verified-event-1"] }, now);
  assert.equal(repeat.applied, false);
  assert.equal(repeat.reason, "EVENT_ALREADY_CONSUMED");
});
test("invalid, future and unconfigured evidence cannot change trust", () => {
  const state = fixture();
  assert.equal(applyVerifiedTrustEvent(state, { ...event("promise_kept"), verified: false } as unknown as VerifiedTrustEvent, { consumedSourceIds: [] }, now).applied, false);
  assert.equal(applyVerifiedTrustEvent(state, { ...event("promise_kept"), occurredAt: new Date("2026-11-06") }, { consumedSourceIds: [] }, now).applied, false);
  assert.equal(applyVerifiedTrustEvent(state, { ...event("promise_kept"), targetId: "unknown" }, { consumedSourceIds: [] }, now).applied, false);
});
