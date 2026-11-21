import test from "node:test";
import assert from "node:assert/strict";
import { kindroidStoryDecisionProvider, kindroidLikeDecisionProvider } from "../src/ai-engine/kindroid";

async function check(run: () => Promise<void>) {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-key";
  try { await run(); } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
}
const kinId = "kin123456789";
const input = { system: "", context: "", outputSchema: {}, validate: () => undefined };
test("story LIKE does not create a text reply", async () => check(async () => {
  const fetcher = (async () => new Response("START MESSAGE\nLIKE\nEND MESSAGE", { status: 200 })) as typeof fetch;
  const result = await kindroidStoryDecisionProvider(kinId, "photo", fetcher).complete(input);
  const decision = JSON.parse(String(result.text));
  assert.equal(decision.action, "react");
  assert.equal(decision.text, null);
  assert.equal(decision.reaction, "❤");
}));
test("story VIEW does not force a reaction", async () => check(async () => {
  const fetcher = (async () => new Response("VIEW", { status: 200 })) as typeof fetch;
  const result = await kindroidStoryDecisionProvider(kinId, "photo", fetcher).complete(input);
  assert.equal(JSON.parse(String(result.text)).action, "none");
}));
test("feed LIKE and SKIP remain independent", async () => check(async () => {
  for (const choice of ["LIKE", "SKIP"]) {
    const fetcher = (async () => new Response("<<START MESSAGE>>\n" + choice + "\n<<END MESSAGE>>", { status: 200 })) as typeof fetch;
    const result = await kindroidLikeDecisionProvider(kinId, "like_post", "post", fetcher).complete(input);
    assert.equal(JSON.parse(String(result.text)).action, choice === "LIKE" ? "like" : "none");
  }
}));
test("invalid social choice never invents an interaction", async () => check(async () => {
  const fetcher = (async () => new Response("I love this photo!", { status: 200 })) as typeof fetch;
  await assert.rejects(() => kindroidStoryDecisionProvider(kinId, "photo", fetcher).complete(input), /KINDROID_SOCIAL_DECISION_INVALID/);
}));
