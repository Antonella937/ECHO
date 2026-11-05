import test from "node:test";
import assert from "node:assert/strict";
import { createSeedState } from "../../echo/src/store/seed";
import { applyAutonomyDecision, SocialExecutionError } from "../src/autonomy/executor";
import type { CharacterDecision, SocialState } from "@workspace/api-zod";
import type { Opportunity } from "../src/autonomy/policy";

const NOW = new Date("2026-11-05T12:00:00.000Z");
function fixture() {
  const state = createSeedState() as SocialState;
  const actor = state.characters.find(c => c.id === "mar");
  const target = state.characters.find(c => c.id === "noah");
  assert.ok(actor && target);
  state.posts = [];
  state.comments = [];
  state.messages = [];
  state.notifications = [];
  state.follows = { ...state.follows, mar: ["noah"] };
  return state;
}
function decision(action: CharacterDecision["action"], situation: CharacterDecision["situation"], text = "Hola desde ECHO"): CharacterDecision {
  return { action, situation, text, reason: "offline social regression", suggestedDelayMinutes: 0, contextSections: ["identity"] };
}
function apply(state: SocialState, opportunity: Opportunity, value: CharacterDecision) {
  let next = 0;
  return applyAutonomyDecision(state, "mar", opportunity, value, NOW, () => "offline-id-" + ++next);
}
test("autonomous post creates only one text post with explicit origin", () => {
  const state = fixture();
  const result = apply(state, { situation: "post" } as Opportunity, decision("draft", "post"));
  assert.equal(result.changed, true);
  assert.equal(result.state.posts.length, 1);
  assert.equal(result.state.posts[0].origin, "autonomy");
  assert.equal(result.state.posts[0].image, "");
  assert.equal(state.posts.length, 0);
});
test("autonomous like cannot target an unrelated author or like twice", () => {
  const state = fixture();
  state.posts.push({
    id: "post-1", authorId: "noah", image: "", caption: "Ensayo",
    location: "", createdAt: NOW, likes: [], savedBy: [], commentsEnabled: true,
  });
  const opportunity = { situation: "like_post", postId: "post-1" } as Opportunity;
  const first = apply(state, opportunity, decision("like", "like_post", ""));
  assert.deepEqual(first.state.posts[0].likes, ["mar"]);
  assert.equal(first.state.notifications.length, 1);
  assert.throws(() => apply(first.state, opportunity, decision("like", "like_post", "")),
    (error: unknown) => error instanceof SocialExecutionError && error.reasonCode === "POST_LIKE_TARGET_UNAVAILABLE");
  const unrelated = { ...state, follows: { ...state.follows, mar: [] } };
  assert.throws(() => apply(unrelated, opportunity, decision("like", "like_post", "")), SocialExecutionError);
});
test("autonomous comments require enabled comments and do not mutate the original state", () => {
  const state = fixture();
  state.posts.push({
    id: "post-1", authorId: "noah", image: "", caption: "Ensayo",
    location: "", createdAt: NOW, likes: [], savedBy: [], commentsEnabled: true,
  });
  const opportunity = { situation: "comment", postId: "post-1" } as Opportunity;
  const result = apply(state, opportunity, decision("draft", "comment"));
  assert.equal(result.state.comments.length, 1);
  assert.equal(result.state.comments[0].origin, "autonomy");
  assert.equal(result.state.notifications.length, 1);
  assert.equal(state.comments.length, 0);
  const blocked = { ...state, posts: [{ ...state.posts[0], commentsEnabled: false }] };
  assert.throws(() => apply(blocked, opportunity, decision("draft", "comment")), SocialExecutionError);
});
test("autonomous DM rejects strangers and accepts an existing conversation", () => {
  const state = fixture();
  const opportunity = { situation: "dm", recipientId: "noah" } as Opportunity;
  assert.throws(() => apply(state, opportunity, decision("draft", "dm")), SocialExecutionError);
  state.messages.push({
    id: "existing", threadId: "mar__noah", senderId: "noah", recipientId: "mar",
    text: "¿Ensayamos?", createdAt: NOW, storyId: null, postId: null, readBy: ["noah"],
  });
  const result = apply(state, opportunity, decision("draft", "dm"));
  assert.equal(result.state.messages.length, 2);
  assert.equal(result.state.messages[1].origin, "autonomy");
  assert.equal(result.state.messages[1].recipientId, "noah");
  assert.equal(result.state.notifications.length, 1);
});
