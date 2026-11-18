import { test } from "node:test";
import assert from "node:assert/strict";
import { kindroidDmProvider } from "../src/ai-engine/kindroid";

test("Kindroid never retries a failed DM request automatically", async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-only-key";
  let calls = 0;
  try {
    const request = (async () => { calls++; throw new Error("network unavailable"); }) as typeof fetch;
    const provider = kindroidDmProvider("hello", "kin_12345678", "", request);
    await assert.rejects(provider.complete({} as Parameters<typeof provider.complete>[0]),
      (error: unknown) => error instanceof Error && error.message.includes("KINDROID_CONNECTION_RETRY_MANUALLY"));
    assert.equal(calls, 1);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test("Kindroid rejects malformed Kin IDs before contacting provider", async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-only-key";
  let calls = 0;
  try {
    const request = (async () => { calls++; return new Response("ok"); }) as typeof fetch;
    const provider = kindroidDmProvider("hello", "bad id", "", request);
    await assert.rejects(provider.complete({} as Parameters<typeof provider.complete>[0]));
    assert.equal(calls, 0);
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});


test("Kindroid sends the expected JSON payload and accepts a plain-text reply", async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-only-key";
  try {
    const request = (async (url: string | URL | Request, init?: RequestInit) => {
      assert.equal(String(url), "https://api.kindroid.ai/v1/send-message");
      assert.equal(init?.method, "POST");
      const body = JSON.parse(String(init?.body)) as Record<string, unknown>;
      assert.deepEqual(body, { ai_id: "kin_12345678", message: "hello", stream: false });
      return new Response("Hello from Kindroid", { status: 200 });
    }) as typeof fetch;
    const provider = kindroidDmProvider("hello", "kin_12345678", "", request);
    const result = await provider.complete({} as Parameters<typeof provider.complete>[0]);
    const decision = JSON.parse(result.text) as { text: string; action: string };
    assert.equal(decision.text, "Hello from Kindroid");
    assert.equal(decision.action, "draft");
  } finally {
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});

test("Kindroid HTTP 400 is reported without retrying or exposing private response bodies", async () => {
  const previous = process.env.ECHO_KINDROID_API_KEY;
  process.env.ECHO_KINDROID_API_KEY = "test-only-key";
  const previousWarn = console.warn;
  let calls = 0;
  let diagnostic: unknown[] = [];
  console.warn = (...args: unknown[]) => { diagnostic = args; };
  try {
    const request = (async () => {
      calls++;
      return new Response(JSON.stringify({ error: "invalid message" }), { status: 400 });
    }) as typeof fetch;
    const provider = kindroidDmProvider("hello", "kin_12345678", "", request);
    await assert.rejects(provider.complete({} as Parameters<typeof provider.complete>[0]),
      (error: unknown) => error instanceof Error && error.message.includes("KINDROID_REQUEST_FAILED_RETRY_MANUALLY"));
    assert.equal(calls, 1);
    assert.equal((diagnostic[1] as { category: string }).category, "invalid_message");
    assert.doesNotMatch(JSON.stringify(diagnostic), /invalid message/);
  } finally {
    console.warn = previousWarn;
    if (previous === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = previous;
  }
});
