import assert from "node:assert/strict";
import { test } from "node:test";
import { VisionError, type VisionProvider } from "../src/vision/contracts";

test("Cloudflare receives image bytes inline and returns a validated analysis", async (t) => {
  const env = process.env;
  process.env = { ...env, CLOUDFLARE_WORKERS_AI_ACCOUNT_ID: "test-account", CLOUDFLARE_WORKERS_AI_TOKEN: "test-token" };
  t.after(() => { process.env = env; });
  const { CloudflareFallbackVisionProvider } = await import("../src/vision/cloudflare");
  const primary: VisionProvider = {
    name: "openrouter",
    async analyze() { throw new VisionError("OPENROUTER_RATE_LIMITED", 429); },
  };
  const provider = new CloudflareFallbackVisionProvider(primary, async (endpoint, request) => {
    assert.match(String(endpoint), /api\.cloudflare\.com\/.*\/ai\/v1\/chat\/completions$/);
    const input = JSON.parse(String(request?.body));
    assert.equal(input.store, false);
    assert.equal(input.model, "@cf/google/gemma-4-26b-a4b-it");
    assert.equal(input.messages[0].content[0].image_url.url, "data:image/jpeg;base64,aW1hZ2U=");
    return Response.json({
      choices: [{ message: { content: '{"sceneDescription":"A mint green car."}' } }],
      usage: { prompt_tokens: 120, completion_tokens: 20 },
    });
  });
  const result = await provider.analyze({
    image: { mimeType: "image/jpeg", base64: "aW1hZ2U=" },
    prompt: "Describe this image.",
    validate: JSON.parse,
  });
  assert.equal(result.analysis.sceneDescription, "A mint green car.");
  assert.equal(result.usage.promptTokens, 120);
  assert.equal(result.provider, "cloudflare-workers-ai");
});
