import { describe, expect, it } from "vitest";
import { canForwardStory, type StorySharePolicyInput } from "../src/lib/storySharePolicy";

const allowed: StorySharePolicyInput = {
  senderId: "sender", authorId: "author", recipientId: "recipient",
  storyActive: true, authorVisibility: "private", recipientCanViewStory: true,
  acceptedFollows: [
    { followerId: "sender", followedId: "recipient" },
    { followerId: "recipient", followedId: "sender" },
    { followerId: "author", followedId: "recipient" },
    { followerId: "recipient", followedId: "author" },
  ], blocks: [], blocksVerified: true,
};

describe("story forwarding authorization", () => {
  it("permits an active story with mutual accepted relationships", () => {
    expect(canForwardStory(allowed)).toBe(true);
  });
  it("rejects a missing reciprocal follow even for a public author", () => {
    expect(canForwardStory({ ...allowed, authorVisibility: "public", acceptedFollows: allowed.acceptedFollows.slice(1) })).toBe(false);
  });
  it("rejects either direction of a block between any participants", () => {
    for (const a of ["sender", "author", "recipient"]) {
      for (const b of ["sender", "author", "recipient"]) {
        if (a === b) continue;
        expect(canForwardStory({ ...allowed, blocks: [{ blockerId: a, blockedId: b }] })).toBe(false);
      }
    }
  });
  it("rejects expired stories and close-friends ineligible recipients", () => {
    expect(canForwardStory({ ...allowed, storyActive: false })).toBe(false);
    expect(canForwardStory({ ...allowed, recipientCanViewStory: false })).toBe(false);
  });
  it("fails closed when block records have not been verified", () => {
    expect(canForwardStory({ ...allowed, blocksVerified: false })).toBe(false);
  });
  it("rejects self-sends and incomplete relationships", () => {
    expect(canForwardStory({ ...allowed, recipientId: "sender" })).toBe(false);
    expect(canForwardStory({ ...allowed, acceptedFollows: [] })).toBe(false);
  });
});
