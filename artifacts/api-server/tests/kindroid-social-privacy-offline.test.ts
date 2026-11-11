import { test } from "node:test";
import assert from "node:assert/strict";
import { visibleSeenStoriesForKindroid, kindroidMemoryAllowed } from "../src/lib/kindroidSocialPrivacy";
import type { SocialState } from "@workspace/api-zod";

const story = (id: string, options: Record<string, unknown> = {}) =>
  ({ id, authorId: "mar", caption: id, seenBy: ["ayelen"], ...options });

test("Kindroid never receives unseen or revoked close-friends stories", () => {
  const state = {
    closeFriends: { mar: ["other"] },
    stories: [
      story("public-seen"),
      story("private-revoked", { closeFriendsOnly: true, allowedViewerIds: ["ayelen"] }),
      story("unseen", { seenBy: [] }),
      story("private-current", { closeFriendsOnly: true, allowedViewerIds: ["ayelen"], authorId: "noah" }),
      story("own", { authorId: "ayelen" }),
    ],
  } as unknown as SocialState;
  (state as unknown as {closeFriends:Record<string,string[]>}).closeFriends.noah = ["ayelen"];
  assert.deepEqual(visibleSeenStoriesForKindroid(state, "ayelen").map(s => s.id),
    ["public-seen", "private-current"]);
});

test("Kindroid excludes private conversation memories belonging to other correspondents", () => {
  assert.equal(kindroidMemoryAllowed({kind:"conversation",targetId:"mar"}, "nela"), false);
  assert.equal(kindroidMemoryAllowed({kind:"conversation",targetId:null}, "nela"), false);
  assert.equal(kindroidMemoryAllowed({kind:"conversation",targetId:"nela"}, "nela"), true);
  assert.equal(kindroidMemoryAllowed({kind:"post",targetId:"mar"}, "nela"), true);
});
