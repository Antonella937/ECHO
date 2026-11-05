import test from "node:test";
import assert from "node:assert/strict";
import { SaveUniverseBody } from "@workspace/api-zod";
import { createSeedState } from "../../echo/src/store/seed";
import { defaultCharacterConfig } from "../../echo/src/domain/character-core";
import { recordIncomingConversationEvents } from "../src/ai-engine/incoming-memory";

function fixture() {
  const state = createSeedState();
  for (const name of ["mar", "noah"]) {
    const actor = state.characters.find(c => c.id === name)!;
    actor.configuration = defaultCharacterConfig(actor);
  }
  return SaveUniverseBody.parse({ state, expectedRevision: 1 }).state;
}

test("recipient remembers new direct message but unrelated characters do not", () => {
  const previous = fixture();
  const incoming = structuredClone(previous);
  incoming.messages.push({
    id: "user-msg-1", threadId: "mar__nela", senderId: "nela", recipientId: "mar",
    text: "Quiero hablar sobre el ensayo de anoche y lo que ocurrió con Noah",
    createdAt: new Date("2026-11-05T12:00:00Z"), storyId: null, postId: null, readBy: ["nela"], origin: "manual",
  });
  const next = recordIncomingConversationEvents(previous, incoming);
  assert.equal(next.characters.find(c => c.id === "mar")!.configuration!.memory.recent.at(-1)?.sourceId, "user-msg-1");
  assert.equal(next.characters.find(c => c.id === "noah")!.configuration!.memory.recent.length, 0);
  assert.equal(previous.characters.find(c => c.id === "mar")!.configuration!.memory.recent.length, 0);
  assert.ok(SaveUniverseBody.safeParse({ state: next, expectedRevision: 1 }).success);
  assert.equal(recordIncomingConversationEvents(next, next).characters.find(c => c.id === "mar")!.configuration!.memory.recent.length, 1);
});

test("existing, hidden and autonomous messages are not ingested", () => {
  const previous = fixture();
  const incoming = structuredClone(previous);
  const base = {
    threadId: "mar__nela", senderId: "nela", recipientId: "mar",
    text: "Necesitamos hablar de todo lo que pasó ayer en el ensayo",
    createdAt: new Date("2026-11-05T12:00:00Z"), storyId: null, postId: null, readBy: ["nela"], origin: "manual",
  };
  incoming.messages.push({ ...base, id: "hidden-msg", hiddenForIds: ["mar"] });
  incoming.messages.push({ ...base, id: "autonomy-msg", origin: "autonomy" });
  incoming.messages.push({ ...base, id: "normal-msg" });
  const next = recordIncomingConversationEvents(previous, incoming);
  assert.deepEqual(next.characters.find(c => c.id === "mar")!.configuration!.memory.recent.map(m => m.sourceId), ["normal-msg"]);
});
