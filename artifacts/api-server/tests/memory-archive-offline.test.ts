import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { recordAutonomyEvent } from "../src/autonomy/event-memory";
import { displacedMemories } from "../src/lib/memoryArchive";

test("archives only verified displaced memories from the same character", () => {
  const seed = createSeedState();
  const mar = seed.characters.find(c => c.id === "mar")!;
  mar.configuration = defaultCharacterConfig(mar);
  mar.configuration.memory.recentLimit = 10;
  let state = SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state;
  for (let i = 0; i < 10; i++) {
    state = recordAutonomyEvent(state, "mar", {
      sourceId: "source-" + i, kind: "conversation",
      text: "Conversation about an actual recorded rehearsal " + i,
    }, new Date("2026-11-05T12:00:00Z"));
  }
  const next = recordAutonomyEvent(state, "mar", {
    sourceId: "source-10", kind: "conversation",
    text: "Conversation about an actual recorded rehearsal 10",
  }, new Date("2026-11-05T13:00:00Z"));
  const archived = displacedMemories(state, next);
  assert.equal(archived.length, 1);
  assert.equal(archived[0].characterId, "mar");
  assert.equal(archived[0].sourceId, "source-0");
  assert.equal(displacedMemories(next, next).length, 0);
  assert.ok(SaveUniverseBody.safeParse({ state: next, expectedRevision: 2 }).success);
});

test("manual memory deletion is never interpreted as verified archive history", () => {
  const seed = createSeedState();
  const mar = seed.characters.find(c => c.id === "mar")!;
  mar.configuration = defaultCharacterConfig(mar);
  mar.configuration.memory.recent.push({
    id: "manual-memory", text: "A manually entered memory", kind: "manual",
    sourceId: null, targetId: null, promotedTo: null,
    createdAt: new Date(), updatedAt: new Date(),
  });
  const state = SaveUniverseBody.parse({ state: seed, expectedRevision: 1 }).state;
  const next = structuredClone(state);
  next.characters.find(c => c.id === "mar")!.configuration!.memory.recent = [];
  assert.deepEqual(displacedMemories(state, next), []);
});
