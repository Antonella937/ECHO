import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { mergeUniverse } from "../../echo/src/store/merge";
import { recordAutonomyEvent } from "../src/autonomy/event-memory";
import { applyApprovedRelationshipTransition, proposeRelationshipTransitions } from "../src/lib/relationshipTransitions";

function fixture() {
  const seed = createSeedState();
  const actor = seed.characters.find(c => c.id === "mar")!;
  actor.configuration = defaultCharacterConfig(actor);
  actor.configuration.relationships.push({
    id: "integration-transition", targetId: "nela", preset: "friend",
    customLabel: "", description: "Historia compartida", closeness: 78,
    trust: 72, attraction: 22, tension: 12,
  });
  return SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state;
}
function relation(state: ReturnType<typeof fixture>) {
  return state.characters.find(c => c.id === "mar")!.configuration!.relationships.find(r => r.targetId === "nela")!;
}
test("proposal -> approval -> event memory -> remote sync preserves other dimensions", () => {
  const base = fixture();
  const proposals = proposeRelationshipTransitions(base, "mar", "nela");
  assert.ok(proposals.some(p => p.from === "friend" && p.to === "close_friend" && p.requiresOwnerApproval));
  const approved = applyApprovedRelationshipTransition(base, "mar", "nela", "friend", "close_friend");
  assert.equal(approved.applied, true);
  const persisted = recordAutonomyEvent(approved.state, "mar", {
    sourceId: "transition:mar:nela:1", kind: "interaction",
    text: "Transición confirmada por el propietario: friend a close_friend",
    targetId: "nela",
  }, new Date("2026-11-05T12:00:00Z"));
  const local = structuredClone(base);
  const merged = mergeUniverse(base, local, persisted);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(relation(merged.state).preset, "close_friend");
  assert.equal(relation(merged.state).trust, 72);
  assert.equal(relation(merged.state).attraction, 22);
  assert.equal(relation(merged.state).tension, 12);
  assert.equal(relation(merged.state).closeness, 78);
  assert.equal(relation(merged.state).description, "Historia compartida");
  assert.equal(relation(base).preset, "friend");
  assert.equal(applyApprovedRelationshipTransition(merged.state, "mar", "nela", "friend", "close_friend").reason, "RELATIONSHIP_CHANGED");
});
test("concurrent local edits to unrelated relationship field survive remote transition", () => {
  const base = fixture();
  const local = structuredClone(base);
  relation(local).description = "Descripción local pendiente";
  const remote = applyApprovedRelationshipTransition(base, "mar", "nela", "friend", "close_friend").state;
  const merged = mergeUniverse(base, local, remote);
  assert.deepEqual(merged.conflicts, []);
  assert.equal(relation(merged.state).preset, "close_friend");
  assert.equal(relation(merged.state).description, "Descripción local pendiente");
});
test("conflicting simultaneous preset edits require resolution instead of silent overwrite", () => {
  const base = fixture();
  const local = structuredClone(base);
  relation(local).preset = "rival";
  const remote = applyApprovedRelationshipTransition(base, "mar", "nela", "friend", "close_friend").state;
  const merged = mergeUniverse(base, local, remote);
  assert.ok(merged.conflicts.some(c => c.path.endsWith(".preset")));
});
