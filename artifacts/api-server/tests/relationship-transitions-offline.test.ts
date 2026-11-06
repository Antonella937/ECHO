import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { proposeRelationshipTransitions, applyApprovedRelationshipTransition, type RelationshipPreset } from "../src/lib/relationshipTransitions";

function fixture(preset: RelationshipPreset, closeness: number, trust: number, attraction: number | null = null, tension: number | null = null) {
  const seed = createSeedState();
  const actor = seed.characters.find(c => c.id === "mar")!;
  actor.configuration = defaultCharacterConfig(actor);
  actor.configuration.relationships.push({
    id: "transition-test", targetId: "nela", preset, customLabel: "Historia compartida",
    description: "Vínculo de prueba", closeness, trust, attraction, tension,
  });
  return SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state;
}
function relation(state: ReturnType<typeof fixture>) {
  return state.characters.find(c => c.id === "mar")!.configuration!.relationships.find(r => r.targetId === "nela")!;
}
test("friend can be proposed as close friend only with sufficient closeness and trust", () => {
  const eligible = fixture("friend", 75, 70);
  const proposals = proposeRelationshipTransitions(eligible, "mar", "nela");
  assert.ok(proposals.some(p => p.to === "close_friend" && p.requiresOwnerApproval));
  assert.ok(!proposeRelationshipTransitions(fixture("friend", 69, 70), "mar", "nela").some(p => p.to === "close_friend"));
  assert.ok(!proposeRelationshipTransitions(fixture("friend", 75, 64), "mar", "nela").some(p => p.to === "close_friend"));
  assert.equal(relation(eligible).preset, "friend");
});
test("approved transition changes only directed preset, preserving relationship values", () => {
  const state = fixture("friend", 75, 70, 25, 10);
  const result = applyApprovedRelationshipTransition(state, "mar", "nela", "friend", "close_friend");
  assert.equal(result.applied, true);
  assert.equal(relation(result.state).preset, "close_friend");
  assert.equal(relation(state).preset, "friend");
  assert.equal(relation(result.state).closeness, 75);
  assert.equal(relation(result.state).trust, 70);
  assert.equal(relation(result.state).attraction, 25);
  assert.equal(relation(result.state).tension, 10);
  assert.equal(relation(result.state).description, "Vínculo de prueba");
});
test("partner proposal requires all thresholds, not merely attraction", () => {
  const eligible = fixture("romantic_tension", 70, 70, 80, 20);
  assert.ok(proposeRelationshipTransitions(eligible, "mar", "nela").some(p => p.to === "partner"));
  assert.ok(!proposeRelationshipTransitions(fixture("romantic_tension", 70, 64, 80, 20), "mar", "nela").some(p => p.to === "partner"));
  assert.ok(!proposeRelationshipTransitions(fixture("romantic_tension", 70, 70, 80, 60), "mar", "nela").some(p => p.to === "partner"));
});
test("breakup, family and custom states are not inferred", () => {
  assert.ok(!proposeRelationshipTransitions(fixture("partner", 95, 95, 90, 90), "mar", "nela").some(p => p.to === "ex"));
  assert.deepEqual(proposeRelationshipTransitions(fixture("family", 95, 95, 95, 0), "mar", "nela"), []);
  assert.deepEqual(proposeRelationshipTransitions(fixture("custom", 95, 95, 95, 0), "mar", "nela"), []);
});
test("stale source, ineligible transition and absent relationships are rejected", () => {
  const state = fixture("friend", 75, 70);
  assert.equal(applyApprovedRelationshipTransition(state, "mar", "nela", "acquaintance", "close_friend").reason, "RELATIONSHIP_CHANGED");
  assert.equal(applyApprovedRelationshipTransition(state, "mar", "nela", "friend", "partner").reason, "TRANSITION_NOT_ELIGIBLE");
  assert.equal(applyApprovedRelationshipTransition(state, "mar", "missing", "friend", "close_friend").applied, false);
});
