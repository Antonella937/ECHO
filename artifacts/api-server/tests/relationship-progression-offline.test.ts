import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { applyApprovedClosenessProgression } from "../src/lib/relationshipProgression";

const now = new Date("2026-11-05T12:00:00Z");
function fixture() {
  const seed = createSeedState();
  const actor = seed.characters.find(c => c.id === "mar")!;
  actor.configuration = defaultCharacterConfig(actor);
  actor.configuration.relationships.push({
    id: "rel-test", targetId: "nela", preset: "friend", customLabel: "",
    description: "", closeness: 40, trust: 50, attraction: null, tension: 0,
    boundaries: "", notes: "",
  } as typeof actor.configuration.relationships[number]);
  const ids: string[] = [];
  for (let day = 1; day <= 3; day++) {
    for (const [senderId, recipientId] of [["mar", "nela"], ["nela", "mar"]]) {
      const id = `msg-${day}-${senderId}`;
      ids.push(id);
      seed.messages.push({
        id, senderId, recipientId, text: "Checking in after rehearsal",
        createdAt: new Date(`2026-11-0${day}T12:00:00Z`),
      } as typeof seed.messages[number]);
    }
  }
  return { state: SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state, ids };
}

test("approved reciprocal evidence increments closeness only once", () => {
  const { state, ids } = fixture();
  const first = applyApprovedClosenessProgression(state, "mar", "nela", now,
    { lastAppliedAt: null, consumedMessageIds: [] });
  assert.equal(first.applied, true);
  const before = state.characters.find(c => c.id === "mar")!.configuration!.relationships[0];
  const after = first.state.characters.find(c => c.id === "mar")!.configuration!.relationships[0];
  assert.equal(before.closeness, 40);
  assert.equal(after.closeness, 41);
  assert.equal(after.trust, before.trust);
  assert.equal(after.preset, before.preset);
  assert.equal(applyApprovedClosenessProgression(first.state, "mar", "nela", now,
    { lastAppliedAt: now, consumedMessageIds: ids }).reason, "RELATIONSHIP_COOLDOWN");
  assert.equal(applyApprovedClosenessProgression(first.state, "mar", "nela",
    new Date("2026-11-20T12:00:00Z"),
    { lastAppliedAt: now, consumedMessageIds: ids }).reason, "INSUFFICIENT_RECIPROCAL_CONTACT");
});

test("cannot progress with no reciprocal evidence", () => {
  const { state } = fixture();
  const result = applyApprovedClosenessProgression(state, "mar", "nela", now,
    { lastAppliedAt: null, consumedMessageIds: state.messages.filter(m => m.senderId === "nela").map(m => m.id) });
  assert.equal(result.applied, false);
  assert.equal(result.state, state);
});
