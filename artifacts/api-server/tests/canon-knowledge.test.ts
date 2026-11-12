import assert from "node:assert/strict";
import { test } from "node:test";
import { knownCanonForCharacter, privateConversationCandidates, dmCanonCandidates, readableCanonTimeline } from "../src/lib/canon-knowledge";

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

test("AI recall excludes private events outside character knowledge", () => {
  const events = [
    { text:"Everyone saw the concert.", visibility:"public", witnessIds:[] },
    { text:"A private confession.", visibility:"private", witnessIds:["ophelia"] },
    { text:"The group made a plan.", visibility:"participants", witnessIds:["ezra","ophelia"] },
    { text:"Unscoped legacy entry." },
  ];
  const ezra = readableCanonTimeline(events, "ezra");
  assert.match(ezra, /concert/);
  assert.match(ezra, /group made a plan/);
  assert.doesNotMatch(ezra, /confession|legacy/);
  assert.equal(readableCanonTimeline(events, "stranger"), "Everyone saw the concert.");
});

test("persisted event permissions survive JSON roundtrip without leaking", () => {
  const saved = JSON.stringify([
    {sourceKey:"dm:ezra:ophelia:m1",text:"A secret promise was made.",visibility:"participants",witnessIds:["ezra","ophelia"]},
    {sourceKey:"group:g1:m2",text:"The group planned their escape.",visibility:"participants",witnessIds:["ezra","ophelia","lucien"]},
    {sourceKey:"scene:s1:m3",text:"The gates opened for everyone.",visibility:"public",witnessIds:[]},
  ]);
  const restored: unknown = JSON.parse(saved);
  assert.match(readableCanonTimeline(restored,"lucien"),/group planned|gates opened/);
  assert.doesNotMatch(readableCanonTimeline(restored,"lucien"),/secret promise/);
  assert.equal(readableCanonTimeline(restored,"outsider"),"The gates opened for everyone.");
});
test("malformed private event metadata is excluded from AI context", () => {
  const malformed = [
    {text:"Unknown private secret.",visibility:"private",witnessIds:[]},
    {text:"Another private secret.",visibility:"participants",witnessIds:"ezra"},
    {text:"A third private secret.",visibility:"private",witnessIds:[42]},
    {text:"A fourth private secret.",visibility:"private",witnessIds:["ezra"],audienceIds:"everyone"},
  ];
  assert.equal(readableCanonTimeline(malformed,"ezra"),"");
});
