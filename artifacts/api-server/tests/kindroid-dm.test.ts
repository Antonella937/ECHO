import test from "node:test";
import assert from "node:assert/strict";
import { kindroidDmProvider } from "../src/ai-engine/kindroid";

const kinId = "kin123456789";
async function withTestKey(run: () => Promise<void>) {
  const old = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-key";
  try { await run(); }
  finally {
    if (old === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = old;
  }
}
test("ordinary DM sends only the message, with no ECHO context wrapper", async () => withTestKey(async () => {
  const requests: Array<{ path: string; body: Record<string, unknown> }> = [];
  const request = (async (url: string | URL | Request, init?: RequestInit) => {
    requests.push({ path: new URL(String(url)).pathname, body: JSON.parse(String(init?.body)) });
    return new Response("Hey there!", { status: 200 });
  }) as typeof fetch;
  const reply = await kindroidDmProvider("Hey, how are you?", kinId, "", request).complete({
    system: "ignore", context: "ignore", outputSchema: {}, validate: () => undefined,
  });
  assert.deepEqual(requests.map(x => x.path), ["/v1/send-message"]);
  assert.deepEqual(requests[0].body, { ai_id: kinId, message: "Hey, how are you?", stream: false });
  assert.match(reply.text, /Hey there!/);
}));
test("explicit story context is sent only when supplied", async () => withTestKey(async () => {
  let body: Record<string, unknown> = {};
  const request = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response("Nice photo!", { status: 200 });
  }) as typeof fetch;
  await kindroidDmProvider("What do you think?", kinId, "Story image: a sunset", request).complete({
    system: "", context: "", outputSchema: {}, validate: () => undefined,
  });
  assert.match(String(body.message), /Story image: a sunset/);
  assert.match(String(body.message), /What do you think\?/);
}));
test("provider error markers never become displayed DM replies", async () => withTestKey(async () => {
  const request = (async () => new Response("<<ERROR>> generation failed", { status: 200 })) as typeof fetch;
  await assert.rejects(() => kindroidDmProvider("Hi", kinId, "", request).complete({
    system: "", context: "", outputSchema: {}, validate: () => undefined,
  }), /KINDROID_GENERATION_FAILED/);
}));

test("story context never truncates the actual short DM", async () => withTestKey(async () => {
  let body: Record<string, unknown> = {};
  const request = (async (_url: string | URL | Request, init?: RequestInit) => {
    body = JSON.parse(String(init?.body));
    return new Response("I saw it.", { status: 200 });
  }) as typeof fetch;
  const message = "M".repeat(2600);
  await kindroidDmProvider(message, kinId, "Visual analysis ".repeat(200), request).complete({
    system: "", context: "", outputSchema: {}, validate: () => undefined,
  });
  const sent = String(body.message);
  assert.ok(sent.length <= 2800);
  assert.ok(sent.endsWith(message), "The actual message must remain intact");
}));

test("oversized DM fails before contacting Kindroid, never sending partial text", async () => withTestKey(async () => {
  let called = false;
  const request = (async () => {
    called = true;
    return new Response("Unexpected", { status: 200 });
  }) as typeof fetch;
  await assert.rejects(() => kindroidDmProvider("X".repeat(2801), kinId, "", request).complete({
    system: "", context: "", outputSchema: {}, validate: () => undefined,
  }), /KINDROID_MESSAGE_TOO_LONG/);
  assert.equal(called, false);
}));

test("private DM removes Kindroid transport markers without altering prose", async () => withTestKey(async () => {
  const request = (async () => new Response("START MESSAGE\nHello Nela!\nEND MESSAGE", { status: 200 })) as typeof fetch;
  const result = await kindroidDmProvider("Hello", kinId, "", request).complete({
    system: "", context: "", outputSchema: {}, validate: () => undefined,
  });
  const parsed = JSON.parse(String(result.text));
  assert.equal(parsed.text, "Hello Nela!");
}));

test("private DM transport refuses social instructions before any API request", async () => withTestKey(async () => {
  let calls = 0;
  const request = (async () => { calls++; return new Response("unexpected"); }) as typeof fetch;
  const input = { system: "", context: "", outputSchema: {}, validate: () => undefined };
  await assert.rejects(
    () => kindroidDmProvider("[ECHO feed interaction: Decide whether to LIKE]", kinId, "", request).complete(input),
    /KINDROID_PRIVATE_DM_SOCIAL_PROMPT_BLOCKED/,
  );
  await assert.rejects(
    () => kindroidDmProvider("Write a caption", kinId, "", request, "post").complete(input),
    /KINDROID_PRIVATE_DM_SOCIAL_PROMPT_BLOCKED/,
  );
  assert.equal(calls, 0);
}));
