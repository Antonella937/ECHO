import assert from "node:assert/strict";
import { test } from "node:test";
import { VisionAnalysisSchema, VisionError, type VisionProvider } from "../src/vision/contracts";
import { FallbackVisionProvider } from "../src/vision/fallback";

test("a busy backup can recover after OpenRouter rate limits the photo", async () => {
  const previousUrl = process.env.ECHO_VISION_WORKER_URL;
  const previousToken = process.env.ECHO_VISION_WORKER_TOKEN;
  process.env.ECHO_VISION_WORKER_URL = "https://vision.example.test";
  process.env.ECHO_VISION_WORKER_TOKEN = "local-test";

  try {
    const primary: VisionProvider = {
      name: "openrouter",
      async analyze() { throw new VisionError("OPENROUTER_RATE_LIMITED", 429); },
    };
    let requests = 0;
    const provider = new FallbackVisionProvider(primary, async () => {
      requests++;
      return requests === 1
        ? new Response(null, { status: 503 })
        : Response.json({ caption: "A mint green car parked on a cobbled street." });
    });
    const result = await provider.analyze({
      image: { mimeType: "image/jpeg", base64: "aW1hZ2U=" },
      prompt: "",
      validate: text => VisionAnalysisSchema.parse(JSON.parse(text)),
    });

    assert.equal(requests, 2);
    assert.deepEqual(result.attempts.map(attempt => attempt.outcome), ["rejected", "accepted"]);
    assert.equal(result.analysis.sceneDescription, "A mint green car parked on a cobbled street.");
  } finally {
    if (previousUrl === undefined) delete process.env.ECHO_VISION_WORKER_URL;
    else process.env.ECHO_VISION_WORKER_URL = previousUrl;
    if (previousToken === undefined) delete process.env.ECHO_VISION_WORKER_TOKEN;
    else process.env.ECHO_VISION_WORKER_TOKEN = previousToken;
  }
});
