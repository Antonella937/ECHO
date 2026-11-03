import test from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";
import { createSeedState } from "../../echo/src/store/seed";
import { buildCharacterContext } from "../src/ai-engine/context";
import { VisionAnalysisSchema, VisionError, type VisionAnalysis } from "../src/vision/contracts";
import { OpenRouterVisionProvider, discoverFreeVisionModels, parseVisionResult } from "../src/vision/openrouter";
import { buildVisionPostSummary } from "../src/vision/service";

const validAnalysis: VisionAnalysis = {
  sceneDescription: "Una figura geométrica roja sobre un fondo azul.",
  setting: "Ilustración de formas geométricas",
  objects: [{
    label: "círculo rojo", category: "object", attributes: ["rojo", "forma circular"],
    position: "center", confidence: 0.98,
  }],
  people: { count: 0, nonIdentifyingDetails: [] },
  activities: [],
  dominantColors: ["azul", "rojo"],
  visibleText: [],
  notableDetails: ["La figura está centrada"],
  uncertainty: [],
};

function model(id: string, extra: Record<string, unknown> = {}) {
  return {
    id,
    architecture: { input_modalities: ["text", "image"], output_modalities: ["text"] },
    pricing: { prompt: "0", completion: "0", request: "0" },
    supported_parameters: ["response_format"],
    ...extra,
  };
}

function apiResponse(result: VisionAnalysis, id: string, cost: number | null = 0) {
  return Response.json({
    model: id,
    choices: [{ finish_reason: "stop", message: { content: JSON.stringify(result) } }],
    usage: { prompt_tokens: 12, completion_tokens: 23, cost },
  });
}

test("Vision schema accepts bounded structured observations and rejects malformed/sensitive output", () => {
  assert.equal(VisionAnalysisSchema.safeParse(validAnalysis).success, true);
  assert.equal(VisionAnalysisSchema.safeParse({ ...validAnalysis, extra: "field" }).success, false);
  assert.throws(() => parseVisionResult(JSON.stringify({ ...validAnalysis, objects: [] , sceneDescription: "x" })), VisionError);
  assert.throws(() => parseVisionResult(JSON.stringify({ ...validAnalysis, visibleText: ["sk-test-secret-token-value"] })), VisionError);
});

test("free model discovery accepts only zero-cost image-to-text catalog entries", async () => {
  const paidId = `vision/paid-${randomUUID()}`;
  const freeId = `vision/free-${randomUUID()}:free`;
  const request: typeof fetch = async () => Response.json({ data: [
    model(paidId, { pricing: { prompt: "0.1", completion: "0.1", request: "0" } }),
    model(freeId),
    model(`vision/text-${randomUUID()}:free`, { architecture: { input_modalities: ["text"], output_modalities: ["text"] } }),
    model(`vision/safety-${randomUUID()}:free`, { id: `vision/content-safety-${randomUUID()}:free` }),
  ] });
  const result = await discoverFreeVisionModels(request);
  assert.deepEqual(result.map(item => item.id), [freeId]);
});

test("OpenRouter Vision sends image bytes to a catalog-verified free model and validates its JSON", async () => {
  const id = `vision/image-${randomUUID()}:free`;
  const imageData = Buffer.from("disposable-test-image").toString("base64");
  const calls: Array<{ url: string; body?: any }> = [];
  const request: typeof fetch = async (input, init) => {
    const url = String(input);
    const body = init?.body ? JSON.parse(String(init.body)) : undefined;
    calls.push({ url, body });
    if (url.endsWith("/models")) return Response.json({ data: [model(id)] });
    assert.equal(body.model, id);
    assert.equal(body.messages[1].content[1].image_url.url, `data:image/png;base64,${imageData}`);
    return apiResponse(validAnalysis, id);
  };
  const provider = new OpenRouterVisionProvider(request);
  const original = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-placeholder-only";
  try {
    const result = await provider.analyze({
      image: { mimeType: "image/png", base64: imageData },
      prompt: "Return the required JSON",
      validate: parseVisionResult,
    });
    assert.equal(result.model, id);
    assert.equal(result.provider, "openrouter");
    assert.equal(result.analysis.sceneDescription, validAnalysis.sceneDescription);
    assert.equal(result.usage.cost, 0);
    assert.equal(result.attempts.length, 1);
    assert.equal(calls.length, 2);
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = original;
  }
});

test("Vision fallback stays on free image models and preserves bounded rejection details", async () => {
  const first = `vision/first-${randomUUID()}:free`;
  const second = `vision/second-${randomUUID()}:free`;
  const attempted: string[] = [];
  const request: typeof fetch = async (input, init) => {
    if (String(input).endsWith("/models")) return Response.json({ data: [model(second), model(first)] });
    const body = JSON.parse(String(init?.body));
    attempted.push(body.model);
    if (body.model === first) return new Response("", { status: 429 });
    return apiResponse(validAnalysis, second);
  };
  const original = process.env.OPENROUTER_API_KEY;
  process.env.OPENROUTER_API_KEY = "test-placeholder-only";
  try {
    const result = await new OpenRouterVisionProvider(request).analyze({
      image: { mimeType: "image/png", base64: "AQID" },
      prompt: "Return JSON",
      validate: parseVisionResult,
    });
    assert.deepEqual(attempted, [first, second]);
    assert.equal(result.model, second);
    assert.ok(result.attempts.every(attempt => attempt.model.endsWith(":free")));
    assert.equal(result.attempts[0].errorCode, "OPENROUTER_RATE_LIMITED");
  } finally {
    if (original === undefined) delete process.env.OPENROUTER_API_KEY;
    else process.env.OPENROUTER_API_KEY = original;
  }
});

test("carousel summary keeps per-image positions and global ordered description", () => {
  const summary = buildVisionPostSummary("post-a", "ensayo", [
    { mediaId: "photo-2", position: 1, analysis: { ...validAnalysis, sceneDescription: "Un cuadro amarillo con un cuadrado azul." } },
    { mediaId: "photo-1", position: 0, analysis: validAnalysis },
  ], 0, 1);
  assert.deepEqual(summary.orderedItems.map(item => [item.mediaId, item.position]), [["photo-1", 0], ["photo-2", 1]]);
  assert.match(summary.overallDescription, /Foto 1:/);
  assert.match(summary.overallDescription, /Foto 2:/);
  assert.equal(summary.imageCount, 2);
  assert.equal(summary.unsupportedVideoCount, 1);
});

test("Brain context receives persisted per-photo analyses and summary without file URLs", () => {
  const state = createSeedState();
  const post = state.posts[0];
  post.media = [
    { id: "photo-1", type: "image", url: "/objects/uploads/private-one" },
    { id: "photo-2", type: "image", url: "/objects/uploads/private-two" },
  ];
  post.image = post.media[0].url;
  const summary = buildVisionPostSummary(post.id, post.caption, [
    { mediaId: "photo-1", position: 0, analysis: validAnalysis },
    { mediaId: "photo-2", position: 1, analysis: { ...validAnalysis, sceneDescription: "Un cuadro amarillo con un cuadrado azul." } },
  ]);
  const built = buildCharacterContext(state, {
    characterId: "mar", situation: "comment", postId: post.id,
  }, new Date(), {
    analyses: {
      [`post:${post.id}:photo-1`]: validAnalysis,
      [`post:${post.id}:photo-2`]: { ...validAnalysis, sceneDescription: "Un cuadro amarillo con un cuadrado azul." },
    },
    postSummaries: { [post.id]: summary },
  });
  const context = JSON.parse(built.serialized);
  const target = context.target.post;
  assert.equal(target.media[0].visionAnalysis.sceneDescription, validAnalysis.sceneDescription);
  assert.match(target.visionSummary.overallDescription, /Foto 2:/);
  assert.equal(built.audit.visionMediaIncluded, 2);
  assert.equal(built.audit.visionPostSummariesIncluded, 1);
  assert.equal(built.serialized.includes("/objects/"), false);
});
