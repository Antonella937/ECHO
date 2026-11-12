import assert from "node:assert/strict";
import test from "node:test";
import { configuredR2, signR2Request, type R2Config } from "../src/lib/cloudflareR2";

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
