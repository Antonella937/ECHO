import assert from "node:assert/strict";
import test from "node:test";
import { configuredR2, signR2Request, type R2Config } from "../src/lib/cloudflareR2";
import { fetchStored } from "../src/routes/supabase-storage";
import { kindroidDmProvider } from "../src/ai-engine/kindroid";

const config: R2Config = {
  accountId: "a".repeat(32),
  bucket: "echo-media",
  accessKeyId: "offline-test-key",
  secretAccessKey: "offline-test-secret",
};

test("R2 signed GET is private, short-lived, and scoped to the object", () => {
  const url = new URL(signR2Request(config, "GET", "r2/00000000-0000-0000-0000-000000000001", 60, new Date("2026-11-12T12:00:00Z")));
  assert.equal(url.protocol, "https:");
  assert.equal(url.hostname, config.accountId + ".r2.cloudflarestorage.com");
  assert.equal(url.pathname, "/echo-media/r2/00000000-0000-0000-0000-000000000001");
  assert.equal(url.searchParams.get("X-Amz-Expires"), "60");
  assert.equal(url.searchParams.get("X-Amz-SignedHeaders"), "host");
  assert.match(url.searchParams.get("X-Amz-Signature") ?? "", /^[a-f0-9]{64}$/);
  assert.ok(!url.toString().includes(config.secretAccessKey));
  assert.equal(signR2Request(config, "GET", "r2/00000000-0000-0000-0000-000000000001", 60, new Date("2026-11-12T12:00:00Z")), url.toString());
});

test("R2 signing rejects traversal and excessive expiry", () => {
  assert.throws(() => signR2Request(config, "GET", "../secret"), /R2_INVALID_OBJECT_KEY/);
  assert.throws(() => signR2Request(config, "GET", "r2/file", 3601), /R2_INVALID_EXPIRY/);
});

test("R2 is not activated without configuration", () => {
  const keys = ["CLOUDFLARE_R2_ACCOUNT_ID", "CLOUDFLARE_R2_BUCKET", "CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY"] as const;
  const previous = keys.map(key => process.env[key]);
  try {
    keys.forEach(key => delete process.env[key]);
    assert.equal(configuredR2(), null);
  } finally {
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("Vision storage reader retrieves private R2 bytes through signed GET without leaking credentials", async () => {
  const keys = ["CLOUDFLARE_R2_ACCOUNT_ID", "CLOUDFLARE_R2_BUCKET", "CLOUDFLARE_R2_ACCESS_KEY_ID", "CLOUDFLARE_R2_SECRET_ACCESS_KEY"] as const;
  const previous = keys.map(key => process.env[key]);
  const originalFetch = globalThis.fetch;
  const calls: string[] = [];
  try {
    process.env.CLOUDFLARE_R2_ACCOUNT_ID = config.accountId;
    process.env.CLOUDFLARE_R2_BUCKET = config.bucket;
    process.env.CLOUDFLARE_R2_ACCESS_KEY_ID = config.accessKeyId;
    process.env.CLOUDFLARE_R2_SECRET_ACCESS_KEY = config.secretAccessKey;
    globalThis.fetch = async (input) => {
      const url = String(input);
      calls.push(url);
      const parsed = new URL(url);
      assert.equal(parsed.hostname, config.accountId + ".r2.cloudflarestorage.com");
      assert.equal(parsed.pathname, "/echo-media/r2/00000000-0000-0000-0000-000000000001");
      assert.match(parsed.searchParams.get("X-Amz-Signature") ?? "", /^[a-f0-9]{64}$/);
      assert.ok(!url.includes(config.secretAccessKey));
      return new Response(new Uint8Array([137,80,78,71,13,10,26,10]), {
        headers: { "content-type": "image/png" },
      });
    };
    const response = await fetchStored("/objects/r2/00000000-0000-0000-0000-000000000001");
    assert.equal(response.status, 200);
    assert.equal(response.headers.get("content-type"), "image/png");
    assert.deepEqual([...new Uint8Array(await response.arrayBuffer())], [137,80,78,71,13,10,26,10]);
    assert.equal(calls.length, 1);
  } finally {
    globalThis.fetch = originalFetch;
    keys.forEach((key, index) => {
      if (previous[index] === undefined) delete process.env[key];
      else process.env[key] = previous[index];
    });
  }
});

test("Kindroid receives cached visual observations as text without sending a real DM", async () => {
  const originalKey = process.env.ECHO_KINDROID_API_KEY;
  const visualDescription = "A red circle centered on a blue canvas";
  const message = "[ECHO private story reply: Caption: studio night. Cached visual observations (not identity verification): " + visualDescription + ". Write one natural private DM about the story using only grounded details.]";
  let calls = 0;
  try {
    process.env.ECHO_KINDROID_API_KEY = "offline-test-only";
    const request: typeof fetch = async (input, init) => {
      calls++;
      assert.equal(String(input), "https://api.kindroid.ai/v1/send-message");
      const body = JSON.parse(String(init?.body)) as { ai_id: string; message: string; stream: boolean };
      assert.equal(body.ai_id, "offline_test_kin_001");
      assert.equal(body.stream, false);
      assert.ok(body.message.includes(visualDescription));
      assert.ok(!body.message.includes("/objects/r2/"));
      return new Response("That red circle is striking.", { status: 200 });
    };
    const provider = kindroidDmProvider(message, "offline_test_kin_001", "", request);
    const result = await provider.complete({} as Parameters<typeof provider.complete>[0]);
    assert.ok(result.text.includes("That red circle is striking."));
    assert.equal(calls, 1);
  } finally {
    if (originalKey === undefined) delete process.env.ECHO_KINDROID_API_KEY;
    else process.env.ECHO_KINDROID_API_KEY = originalKey;
  }
});
