import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { applyVerifiedAttractionEvent, type VerifiedAttractionEvent } from "../src/lib/relationshipAttraction";

const now = new Date("2026-11-05T12:00:00Z");
function fixture(attraction: number | null = 40) {
  const seed = createSeedState();
  const actor = seed.characters.find(c => c.id === "mar")!;
  actor.configuration = defaultCharacterConfig(actor);
  actor.configuration.relationships.push({
    id: "attraction-test", targetId: "nela", preset: "friend", customLabel: "",
    description: "", closeness: 40, trust: 50, attraction, tension: 20,
    boundaries: "", notes: "",
  } as typeof actor.configuration.relationships[number]);
  return SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state;
}
function event(kind: VerifiedAttractionEvent["kind"]): VerifiedAttractionEvent {
  return { sourceId: "event-1", actorId: "mar", targetId: "nela",
    kind, occurredAt: new Date("2026-11-04T12:00:00Z"), verified: true };
}
function relation(state: ReturnType<typeof fixture>) {
  return state.characters.find(c => c.id === "mar")!.configuration!.relationships[0];
}
test("reciprocal flirting increases attraction without altering trust, tension or closeness", () => {
  const state = fixture();
  const result = applyVerifiedAttractionEvent(state, event("mutual_flirting_confirmed"), { consumedSourceIds: [] }, now);
  assert.equal(result.applied, true);
  assert.equal(result.delta, 3);
  assert.equal(relation(result.state).attraction, 43);
  assert.equal(relation(result.state).trust, 50);
  assert.equal(relation(result.state).tension, 20);
  assert.equal(relation(result.state).closeness, 40);
  assert.equal(relation(state).attraction, 40);
});
test("reconciliation lowers attraction and respects lower boundary", () => {
  assert.equal(relation(applyVerifiedAttractionEvent(fixture(), event("romantic_interest_declined"), { consumedSourceIds: [] }, now).state).attraction, 35);
  const result = applyVerifiedAttractionEvent(fixture(2), event("romantic_interest_declined"), { consumedSourceIds: [] }, now);
  assert.equal(result.delta, -2);
  assert.equal(relation(result.state).attraction, 0);
});
test("unverified, reused, future or disabled evidence cannot alter attraction", () => {
  const state = fixture();
  assert.equal(applyVerifiedAttractionEvent(state, { ...event("mutual_flirting_confirmed"), verified: false } as VerifiedAttractionEvent, { consumedSourceIds: [] }, now).applied, false);
  assert.equal(applyVerifiedAttractionEvent(state, event("mutual_flirting_confirmed"), { consumedSourceIds: ["event-1"] }, now).applied, false);
  assert.equal(applyVerifiedAttractionEvent(state, { ...event("mutual_flirting_confirmed"), occurredAt: new Date("2026-11-06") }, { consumedSourceIds: [] }, now).applied, false);
  assert.equal(applyVerifiedAttractionEvent(fixture(null), event("mutual_flirting_confirmed"), { consumedSourceIds: [] }, now).reason, "ATTRACTION_DISABLED");
});
