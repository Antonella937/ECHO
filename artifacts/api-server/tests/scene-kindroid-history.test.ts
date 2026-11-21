import assert from "node:assert/strict";
import test from "node:test";
import { mapKindroidSceneHistory } from "../src/lib/scene-kindroid-history";

const groupId = "A1C6M15BpSOmRC9Qi7m5";
const kinToCharacter = new Map([["kin-mar", "mar"], ["kin-noah", "noah"], ["kin-other", "outsider"]]);
const allowed = new Set(["mar", "noah"]);
const message = (id: string, sender: string, text: string) => ({id, sender, message: text, timestamp: 1_790_000_000});

test("maps only linked participants and deduplicates stable Kindroid IDs", () => {
  const result = mapKindroidSceneHistory(groupId, [
    message("one", "kin-mar", "*Mar looks at Noah.* Are you serious?"),
    message("one", "kin-mar", "duplicate"),
    message("two", "kin-noah", "Absolutely."),
    message("three", "kin-other", "wrong group participant"),
    message("four", "unmapped", "unknown"),
  ], kinToCharacter, allowed);
  assert.equal(result.length, 2);
  assert.deepEqual(result.map(e => e.actorId), ["mar", "noah"]);
  assert.match(result[0].text, /Mar looks at Noah/);
  assert.ok(result.every(e => e.eventId.startsWith("kindroid_")));
});

test("does not trust display names or malformed message fields", () => {
  const result = mapKindroidSceneHistory(groupId, [
    {...message("one", "unmapped", "spoof"), display_name: "Mar"},
    {...message("two", "kin-mar", "invalid"), timestamp: "yesterday"},
    {...message("three", "kin-mar", " ")},
    null,
  ], kinToCharacter, allowed);
  assert.deepEqual(result, []);
});

test("different group IDs yield different event IDs for identical message IDs", () => {
  const first = mapKindroidSceneHistory(groupId, [message("one", "kin-mar", "Hi")], kinToCharacter, allowed);
  const second = mapKindroidSceneHistory("anotherGroupId123", [message("one", "kin-mar", "Hi")], kinToCharacter, allowed);
  assert.notEqual(first[0].eventId, second[0].eventId);
});
