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
