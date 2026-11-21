import test from "node:test";
import assert from "node:assert/strict";
import { parseKindroidGroupId } from "../src/lib/kindroid-group-id";

const id = "A1C6M15BpSOmRC9Qi7m5";
test("accepts the Kindroid group URL copied from the app", () => {
  assert.equal(parseKindroidGroupId(`https://kindroid.ai/v2/chat/group/${id}/`), id);
  assert.equal(parseKindroidGroupId(`https://kindroid.ai/v2/chat/group/${id}`), id);
  assert.equal(parseKindroidGroupId(`  ${id}  `), id);
});
test("rejects spoofed hosts, other routes and ambiguous links", () => {
  for (const value of [
    `http://kindroid.ai/v2/chat/group/${id}/`,
    `https://kindroid.ai.evil.example/v2/chat/group/${id}/`,
    `https://kindroid.ai@evil.example/v2/chat/group/${id}/`,
    `https://kindroid.ai/v2/chat/${id}/`,
    `https://kindroid.ai/v2/chat/group/${id}/?x=1`,
    `https://kindroid.ai/v2/chat/group/${id}/#x`,
    `https://kindroid.ai/v2/chat/group/${id}/extra`,
    "not a group",
  ]) assert.equal(parseKindroidGroupId(value), null, value);
});
