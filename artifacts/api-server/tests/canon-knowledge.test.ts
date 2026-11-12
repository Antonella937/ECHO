import assert from "node:assert/strict";
import { test } from "node:test";
import { knownCanonForCharacter, privateConversationCandidates, dmCanonCandidates } from "../src/lib/canon-knowledge";

test("characters only learn public or witnessed events", () => {
  const events = [
    { text: "public", visibility: "public" as const, witnessIds: [] },
    { text: "secret", visibility: "private" as const, witnessIds: ["ophelia"] },
    { text: "group", visibility: "participants" as const, witnessIds: ["ezra", "ophelia"] },
  ];
  assert.deepEqual(knownCanonForCharacter(events, "ezra"), ["public", "group"]);
  assert.deepEqual(knownCanonForCharacter(events, "stranger"), ["public"]);
});
test("group candidates only include messages from group members and remain restricted", () => {
  const rows = [
    { id:"a", senderId:"ezra", text:"The violet smoke filled the corridor, and everyone ran out of the classroom.", createdAt:"2026-11-12" },
    { id:"b", senderId:"outsider", text:"The violet smoke filled the corridor, and everyone ran out of the classroom.", createdAt:"2026-11-12" },
  ];
  const result = privateConversationCandidates(rows, ["ezra","ophelia"]);
  assert.equal(result.length, 1);
  assert.deepEqual(result[0].witnessIds, ["ezra","ophelia"]);
  assert.equal(result[0].visibility, "participants");
});

test("DM candidates exclude unrelated and hidden conversations", () => {
  const text = "The violet smoke filled the corridor, and everyone ran out of the classroom.";
  const messages = [
    { id:"a", senderId:"ezra", recipientId:"ophelia", text },
    { id:"b", senderId:"ezra", recipientId:"someone-else", text },
    { id:"c", senderId:"ophelia", recipientId:"ezra", text, hiddenForIds:["ezra"] },
  ];
  const result = dmCanonCandidates(messages, "ezra", "ophelia");
  assert.deepEqual(result.map(event => event.sourceId), ["a"]);
  assert.deepEqual(result[0].witnessIds, ["ezra","ophelia"]);
});
