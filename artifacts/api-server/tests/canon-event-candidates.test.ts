import assert from "node:assert/strict";
import { test } from "node:test";
import { sceneCanonCandidates } from "../src/lib/canon-event-candidates";

const event = (overrides: Record<string, unknown> = {}) => ({
  eventId: "event-1", actorId: "ezra", text: "The students entered the corridor and witnessed the violet smoke spreading.",
  createdAt: "2026-11-12T12:00:00Z", visibility: "public", audienceIds: [], ...overrides,
});

test("public main-scene event is a pending proposal, not canonical history", () => {
  const result = sceneCanonCandidates("scene-1", [event()]);
  assert.equal(result.length, 1);
  assert.equal(result[0].status, "pending");
  assert.equal(result[0].sourceId, "event-1");
});
test("private and audience-restricted events never become shared candidates", () => {
  assert.deepEqual(sceneCanonCandidates("scene-1", [
    event({ visibility: "private" }),
    event({ visibility: "participants" }),
    event({ audienceIds: ["ophelia"] }),
    event({ text: "short" }),
  ]), []);
});
test("scene candidate source is scoped to the requested scene", () => {
  assert.equal(sceneCanonCandidates("scene-other", [event()])[0].sceneId, "scene-other");
});

test("CJK narratives can become review candidates without whitespace", () => {
  const narratives = [
    "彼女は廊下の奥で不思議な紫色の煙を発見し、友人たちを急いで呼びに行った。",
    "她在走廊尽头发现了奇怪的紫色烟雾，于是立刻跑去通知其他朋友。",
    "그녀는 복도 끝에서 이상한 보라색 연기를 발견하고 서둘러 친구들에게 알렸다.",
  ];
  for (const text of narratives) {
    assert.equal(sceneCanonCandidates("scene-cjk", [event({text})]).length, 1, text);
  }
});
