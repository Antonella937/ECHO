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
