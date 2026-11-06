import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { applyVerifiedTensionEvent, type VerifiedTensionEvent } from "../src/lib/relationshipTension";

const now = new Date("2026-11-05T12:00:00Z");
function fixture(tension: number | null = 40) {
  const seed = createSeedState();
  const actor = seed.characters.find(c => c.id === "mar")!;
  actor.configuration = defaultCharacterConfig(actor);
  actor.configuration.relationships.push({
    id: "tension-test", targetId: "nela", preset: "friend", customLabel: "",
    description: "", closeness: 40, trust: 50, attraction: 20, tension,
    boundaries: "", notes: "",
  } as typeof actor.configuration.relationships[number]);
  return SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state;
}
function event(kind: VerifiedTensionEvent["kind"]): VerifiedTensionEvent {
  return { sourceId: "event-1", actorId: "mar", targetId: "nela",
    kind, occurredAt: new Date("2026-11-04T12:00:00Z"), verified: true };
}
function relation(state: ReturnType<typeof fixture>) {
  return state.characters.find(c => c.id === "mar")!.configuration!.relationships[0];
}
test("arguments increase tension without altering trust, attraction or closeness", () => {
  const state = fixture();
  const result = applyVerifiedTensionEvent(state, event("argument_confirmed"), { consumedSourceIds: [] }, now);
  assert.equal(result.applied, true);
  assert.equal(result.delta, 5);
  assert.equal(relation(result.state).tension, 45);
  assert.equal(relation(result.state).trust, 50);
  assert.equal(relation(result.state).attraction, 20);
  assert.equal(relation(result.state).closeness, 40);
  assert.equal(relation(state).tension, 40);
});
test("reconciliation lowers tension and respects lower boundary", () => {
  assert.equal(relation(applyVerifiedTensionEvent(fixture(), event("reconciliation_confirmed"), { consumedSourceIds: [] }, now).state).tension, 33);
  const result = applyVerifiedTensionEvent(fixture(2), event("reconciliation_confirmed"), { consumedSourceIds: [] }, now);
  assert.equal(result.delta, -2);
  assert.equal(relation(result.state).tension, 0);
});
test("unverified, reused, future or disabled evidence cannot alter tension", () => {
  const state = fixture();
  assert.equal(applyVerifiedTensionEvent(state, { ...event("argument_confirmed"), verified: false } as VerifiedTensionEvent, { consumedSourceIds: [] }, now).applied, false);
  assert.equal(applyVerifiedTensionEvent(state, event("argument_confirmed"), { consumedSourceIds: ["event-1"] }, now).applied, false);
  assert.equal(applyVerifiedTensionEvent(state, { ...event("argument_confirmed"), occurredAt: new Date("2026-11-06") }, { consumedSourceIds: [] }, now).applied, false);
  assert.equal(applyVerifiedTensionEvent(fixture(null), event("argument_confirmed"), { consumedSourceIds: [] }, now).reason, "TENSION_NOT_ENABLED");
});
