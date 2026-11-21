import test from "node:test";
import assert from "node:assert/strict";
import { storyOpportunityAllowed, type ExecutedAutonomyAction } from "../src/autonomy/policy";

const now = new Date("2026-11-20T20:00:00Z");
const storyId = "story-one";
const attempt = (action: string, hoursAgo: number): ExecutedAutonomyAction => ({
  status: "executed", action, situation: "story_reaction", targetId: storyId,
  createdAt: new Date(now.getTime() - hoursAgo * 60 * 60_000),
});
test("unseen story may be considered", () => {
  assert.equal(storyOpportunityAllowed([], storyId, now), true);
});
test("view without like may be reconsidered after two hours", () => {
  assert.equal(storyOpportunityAllowed([attempt("none", 1)], storyId, now), false);
  assert.equal(storyOpportunityAllowed([attempt("none", 3)], storyId, now), true);
});
test("a reaction is final and a story is considered at most twice", () => {
  assert.equal(storyOpportunityAllowed([attempt("react", 3)], storyId, now), false);
  assert.equal(storyOpportunityAllowed([attempt("none", 5), attempt("none", 3)], storyId, now), false);
});
test("unrelated story decisions do not block a new story", () => {
  assert.equal(storyOpportunityAllowed([attempt("react", 3)], "other-story", now), true);
});
