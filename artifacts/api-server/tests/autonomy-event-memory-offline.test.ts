import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { recordAutonomyEvent } from "../src/autonomy/event-memory";

function fixture() {
  const state = createSeedState();
  const actor = state.characters.find(c => c.id === "mar")!;
  actor.configuration = defaultCharacterConfig(actor);
  actor.configuration.memory.recentLimit = 2;
  return SaveUniverseBody.parse({ state, expectedRevision: 1 }).state;
}

test("records a verified event exactly once and preserves the input", () => {
  const state = fixture();
  const next = recordAutonomyEvent(state, "mar", {
    sourceId: "post-1", kind: "post", text: "Publicado: Hoy terminamos de ensayar todos juntos",
  }, new Date("2026-11-05T12:00:00Z"));
  assert.equal(state.characters.find(c => c.id === "mar")!.configuration!.memory.recent.length, 0);
  assert.equal(next.characters.find(c => c.id === "mar")!.configuration!.memory.recent[0].sourceId, "post-1");
  assert.equal(recordAutonomyEvent(next, "mar", {
    sourceId: "post-1", kind: "post", text: "Publicado: Hoy terminamos de ensayar todos juntos",
  }, new Date()).characters.find(c => c.id === "mar")!.configuration!.memory.recent.length, 1);
  assert.ok(SaveUniverseBody.safeParse({ state: next, expectedRevision: 2 }).success);
});

test("bounds recent memories and does not write to other characters", () => {
  let state = fixture();
  for (let i = 0; i < 3; i++) {
    state = recordAutonomyEvent(state, "mar", {
      sourceId: "event-" + i, kind: "interaction", text: "Comentario verificable sobre el ensayo de hoy " + i,
    }, new Date("2026-11-05T12:00:00Z"));
  }
  const recent = state.characters.find(c => c.id === "mar")!.configuration!.memory.recent;
  assert.deepEqual(recent.map(m => m.sourceId), ["event-1", "event-2"]);
  assert.equal(state.characters.find(c => c.id === "noah")?.configuration?.memory.recent.length ?? 0, 0);
});

test("rejects trivial, missing-source and missing-character events", () => {
  const state = fixture();
  assert.equal(recordAutonomyEvent(state, "mar", { sourceId: "", kind: "post", text: "A very long event that should be rejected" }, new Date()), state);
  assert.equal(recordAutonomyEvent(state, "mar", { sourceId: "short", kind: "post", text: "hola" }, new Date()), state);
  assert.equal(recordAutonomyEvent(state, "missing", { sourceId: "x", kind: "post", text: "A very long event that should be rejected" }, new Date()), state);
});
