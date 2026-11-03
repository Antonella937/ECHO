/**
 * End-to-end Vision v1 check. Uses only disposable Clerk development owners,
 * their isolated universes and uploaded fixture images. Always cleans them up.
 */
import { chromium, type Page } from "@playwright/test";
import { createRequire } from "node:module";
import { randomUUID } from "node:crypto";
import { readdir } from "node:fs/promises";
import { deflateSync } from "node:zlib";
import assert from "node:assert/strict";
import { createSeedState } from "../../artifacts/echo/src/store/seed";

const serverRequire = createRequire(new URL("../../artifacts/api-server/package.json", import.meta.url));
const { clerkClient } = serverRequire("@clerk/express");
const {
  db, pool, echoUniversesTable, echoMediaTable, echoVisionAnalysesTable,
  echoVisionMediaRefsTable, echoVisionPostSummariesTable,
  echoAutonomyRunsTable, echoAutonomyOwnersTable, echoAutonomyCharactersTable,
} = serverRequire("@workspace/db");
const { eq, and } = serverRequire("drizzle-orm");
const { ObjectStorageService } = await import("../../artifacts/api-server/src/lib/objectStorage");
const base = process.env.REPLIT_DEV_DOMAIN
  ? `https://${process.env.REPLIT_DEV_DOMAIN}`
  : "http://localhost:80";

if (process.env.NODE_ENV === "production"
  || !process.env.CLERK_PUBLISHABLE_KEY?.startsWith("pk_test_")
  || !process.env.CLERK_SECRET_KEY?.startsWith("sk_test_")
  || (process.env.REPLIT_DEV_DOMAIN && !process.env.REPLIT_DEV_DOMAIN.endsWith(".replit.dev"))) {
  throw new Error("VISION_LIVE_CHECK_REQUIRES_CLERK_DEVELOPMENT_ENVIRONMENT");
}
if (process.env.AUTONOMY_LIVE_EXECUTION_ENABLED === "true") {
  throw new Error("VISION_LIVE_CHECK_REQUIRES_AUTONOMY_LIVE_OFF");
}

function crc32(data: Buffer): number {
  let crc = 0xffffffff;
  for (const byte of data) {
    crc ^= byte;
    for (let bit = 0; bit < 8; bit++) crc = (crc >>> 1) ^ ((crc & 1) ? 0xedb88320 : 0);
  }
  return (crc ^ 0xffffffff) >>> 0;
}

function pngChunk(name: string, data: Buffer): Buffer {
  const type = Buffer.from(name, "ascii");
  const length = Buffer.alloc(4); length.writeUInt32BE(data.length);
  const checksum = Buffer.alloc(4); checksum.writeUInt32BE(crc32(Buffer.concat([type, data])));
  return Buffer.concat([length, type, data, checksum]);
}

function geometricPng(kind: "circle" | "square"): Buffer {
  const width = 256, height = 256;
  const header = Buffer.alloc(13);
  header.writeUInt32BE(width, 0); header.writeUInt32BE(height, 4);
  header[8] = 8; header[9] = 2; // 8-bit RGB
  const pixels = Buffer.alloc((width * 3 + 1) * height);
  const background = kind === "circle" ? [24, 96, 220] : [248, 220, 42];
  const shape = kind === "circle" ? [240, 30, 34] : [18, 37, 92];
  for (let y = 0; y < height; y++) {
    const rowStart = y * (width * 3 + 1);
    pixels[rowStart] = 0; // PNG filter type None
    for (let x = 0; x < width; x++) {
      const dx = x - 128, dy = y - 128;
      const inside = kind === "circle"
        ? dx * dx + dy * dy <= 76 * 76
        : x >= 54 && x <= 202 && y >= 54 && y <= 202;
      const color = inside ? shape : background;
      const pixel = rowStart + 1 + x * 3;
      pixels[pixel] = color[0]; pixels[pixel + 1] = color[1]; pixels[pixel + 2] = color[2];
    }
  }
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk("IHDR", header),
    pngChunk("IDAT", deflateSync(pixels)),
    pngChunk("IEND", Buffer.alloc(0)),
  ]);
}

const createdOwners: string[] = [];
const ownerPages = new Map<string, Page>();
const runId = randomUUID();
const nonce = Date.now().toString(36);
let browser: Awaited<ReturnType<typeof chromium.launch>> | undefined;
let cleanupSucceeded = false;
let report: Record<string, unknown> = {};

async function createDisposableOwner(autonomyPreview = false): Promise<string> {
  const user = await clerkClient.users.createUser({
    emailAddress: [`echo_${nonce}_${createdOwners.length}+clerk_test@example.com`],
    skipPasswordRequirement: true,
    ...(autonomyPreview ? { publicMetadata: { echoAutonomyPreviewTest: true } } : {}),
  });
  createdOwners.push(user.id);
  return user.id;
}

async function signIn(ownerId: string): Promise<Page> {
  const context = await browser!.newContext({ viewport: { width: 390, height: 844 } });
  const page = await context.newPage();
  const ticket = await clerkClient.signInTokens.createSignInToken({ userId: ownerId, expiresInSeconds: 120 });
  await page.goto(`${base}/sign-in`);
  await page.waitForFunction(() => (window as any).Clerk?.loaded, { timeout: 30_000 });
  await page.evaluate(async (token) => {
    const clerk = (window as any).Clerk;
    const attempt = await clerk.client.signIn.create({ strategy: "ticket", ticket: token });
    if (attempt.status !== "complete") throw new Error("DISPOSABLE_CLERK_SIGN_IN_FAILED");
    await clerk.setActive({ session: attempt.createdSessionId });
  }, ticket.token);
  await page.goto(base);
  const universe = await page.context().request.get(`${base}/api/universe`, {
    headers: { "cache-control": "no-store" },
  });
  assert.equal(universe.status(), 200, "disposable owner must read its private universe");
  const body = await universe.json();
  return page;
}

async function envelope(page: Page) {
  const response = await page.context().request.get(`${base}/api/universe`, {
    headers: { "cache-control": "no-store" },
  });
  assert.equal(response.status(), 200);
  return response.json();
}

async function ensureDisposableUniverse(page: Page) {
  let current = await envelope(page);
  if (!current.state) {
    const initialized = await page.context().request.put(`${base}/api/universe`, {
      data: { state: createSeedState(), expectedRevision: current.revision },
    });
    assert.equal(initialized.status(), 200, "must initialize only the disposable test universe");
    current = await envelope(page);
  }
  assert.ok(current.state?.characters?.some((character: any) => character.id === "nela"));
  return current;
}

async function uploadPrivateImage(page: Page, name: string, bytes: Buffer): Promise<string> {
  try {
    const requested = await page.context().request.post(`${base}/api/storage/uploads/request-url`, {
      data: { name, size: bytes.length, contentType: "image/png" },
    });
    assert.equal(requested.status(), 200, "private upload URL request must succeed");
    const { uploadURL, objectPath } = await requested.json();
    assert.match(objectPath, /^\/objects\/uploads\/[a-f0-9-]+$/i);
    const uploaded = await page.context().request.put(uploadURL, {
      headers: { "content-type": "image/png" },
      data: bytes,
    });
    assert.ok(uploaded.ok(), "synthetic PNG must upload to its signed private URL");
    const claimed = await page.context().request.post(`${base}/api/storage/uploads/claim`, {
      data: { objectPath },
    });
    assert.equal(claimed.status(), 200, "upload must be marked private and owner-scoped");
    return objectPath;
  } catch {
    // Do not expose a signed storage URL or request headers in test output.
    throw new Error("DISPOSABLE_IMAGE_UPLOAD_FAILED");
  }
}

function containsAny(value: unknown, terms: string[]): boolean {
  const text = JSON.stringify(value).toLowerCase();
  return terms.some(term => text.includes(term));
}

async function queryVisionRows(ownerId: string, postId: string) {
  const analyses = await db.select({
    id: echoVisionAnalysesTable.id,
    contentHash: echoVisionAnalysesTable.contentHash,
    status: echoVisionAnalysesTable.status,
    model: echoVisionAnalysesTable.model,
  }).from(echoVisionAnalysesTable).where(eq(echoVisionAnalysesTable.ownerId, ownerId));
  const refs = await db.select().from(echoVisionMediaRefsTable).where(and(
    eq(echoVisionMediaRefsTable.ownerId, ownerId),
    eq(echoVisionMediaRefsTable.entityId, postId),
  ));
  const summaries = await db.select().from(echoVisionPostSummariesTable).where(and(
    eq(echoVisionPostSummariesTable.ownerId, ownerId),
    eq(echoVisionPostSummariesTable.postId, postId),
  ));
  return { analyses, refs, summaries };
}

function safeError(error: unknown): string {
  const message = error instanceof Error ? error.message : "unknown";
  return message.replace(/https?:\/\/\S+/gi, "[redacted-url]")
    .replace(/(?:sk|or)-[a-z0-9_-]{12,}/gi, "[redacted]").slice(0, 200);
}

try {
  const chromiumPath = (await readdir("/nix/store")).find(path => path.includes("playwright-chromium-cjk"));
  if (!chromiumPath) throw new Error("CHROMIUM_NOT_AVAILABLE");
  browser = await chromium.launch({
    executablePath: `/nix/store/${chromiumPath}/chrome-linux/chrome`,
    args: ["--no-sandbox"],
  });

  const ownerId = await createDisposableOwner(true);
  const ownerPage = await signIn(ownerId);
  ownerPages.set(ownerId, ownerPage);
  const otherOwnerId = await createDisposableOwner(false);
  const otherOwnerPage = await signIn(otherOwnerId);
  ownerPages.set(otherOwnerId, otherOwnerPage);

  const initial = await ensureDisposableUniverse(ownerPage);
  await ensureDisposableUniverse(otherOwnerPage);
  const source = initial.state.posts.find((post: any) => post.authorId === "nela") ?? initial.state.posts[0];
  assert.ok(source, "disposable universe must contain a post template");
  const firstPath = await uploadPrivateImage(ownerPage, "vision-blue-red-circle.png", geometricPng("circle"));
  const secondPath = await uploadPrivateImage(ownerPage, "vision-yellow-blue-square.png", geometricPng("square"));

  const postId = `vision-${runId}`;
  const fixturePost = structuredClone(source);
  fixturePost.id = postId;
  fixturePost.authorId = "nela";
  fixturePost.image = firstPath;
  fixturePost.media = [
    { id: `vision-photo-1-${runId}`, type: "image", url: firstPath },
    { id: `vision-photo-2-${runId}`, type: "image", url: secondPath },
  ];
  fixturePost.caption = "Prueba desechable de Vision: dos figuras geométricas.";
  fixturePost.createdAt = new Date().toISOString();
  fixturePost.likes = [];
  fixturePost.savedBy = [];
  fixturePost.commentCount = 0;
  initial.state.posts.push(fixturePost);
  const setup = await ownerPage.context().request.put(`${base}/api/universe`, {
    data: { state: initial.state, expectedRevision: initial.revision },
  });
  assert.equal(setup.status(), 200, "test post must save only in the disposable owner's universe");
  const baseline = await envelope(ownerPage);
  const baselineState = structuredClone(baseline.state);
  const baselineRevision = baseline.revision;

  // Cross-owner request must not locate or analyze the first owner's post.
  const crossOwner = await otherOwnerPage.context().request.post(`${base}/api/ai-engine/vision/analyze`, {
    data: { postId },
  });
  assert.equal(crossOwner.status(), 404, "second owner must not resolve first owner's post");

  const firstResponse = await ownerPage.context().request.post(`${base}/api/ai-engine/vision/analyze`, {
    data: { postId },
  });
  assert.equal(firstResponse.status(), 200, "authenticated owner Vision route must analyze the fixture");
  const firstResult = await firstResponse.json();
  assert.equal(firstResult.entityType, "post");
  assert.equal(firstResult.entityId, postId);
  assert.equal(firstResult.items.length, 2);
  assert.deepEqual(firstResult.items.map((item: any) => item.position), [0, 1]);
  assert.ok(firstResult.items.every((item: any) => item.provider === "openrouter"));
  assert.ok(firstResult.items.every((item: any) => item.model.endsWith(":free")));
  assert.ok(firstResult.items.every((item: any) => item.usage.cost == null || item.usage.cost <= 0));
  assert.ok(firstResult.items.every((item: any) => item.attempts.some((attempt: any) =>
    attempt.outcome === "accepted" && attempt.model.endsWith(":free"))));
  assert.ok(containsAny(firstResult.items[0].analysis, ["azul", "blue"]));
  assert.ok(containsAny(firstResult.items[0].analysis, ["rojo", "red"]));
  assert.ok(containsAny(firstResult.items[1].analysis, ["amarillo", "yellow"]));
  assert.ok(containsAny(firstResult.items[1].analysis, ["cuadrad", "square", "rectáng", "rectang"]));
  assert.equal(firstResult.summary.imageCount, 2);
  assert.deepEqual(firstResult.summary.orderedItems.map((item: any) => item.position), [0, 1]);
  assert.match(firstResult.summary.overallDescription, /Foto 1:/);
  assert.match(firstResult.summary.overallDescription, /Foto 2:/);

  const afterFirst = await queryVisionRows(ownerId, postId);
  assert.equal(afterFirst.analyses.length, 2);
  assert.equal(new Set(afterFirst.analyses.map((row: any) => row.contentHash)).size, 2);
  assert.ok(afterFirst.analyses.every((row: any) => row.status === "complete"));
  assert.equal(afterFirst.refs.length, 2);
  assert.equal(afterFirst.summaries.length, 1);

  // Same post and image bytes: response must be cache-only, with no provider attempt.
  const secondResponse = await ownerPage.context().request.post(`${base}/api/ai-engine/vision/analyze`, {
    data: { postId },
  });
  assert.equal(secondResponse.status(), 200);
  const secondResult = await secondResponse.json();
  assert.deepEqual(secondResult.items.map((item: any) => item.analysisId),
    firstResult.items.map((item: any) => item.analysisId));
  assert.ok(secondResult.items.every((item: any) => item.cacheHit === true));
  assert.ok(secondResult.items.every((item: any) => item.attempts.length === 0));
  const afterSecond = await queryVisionRows(ownerId, postId);
  assert.equal(afterSecond.analyses.length, afterFirst.analyses.length);
  assert.equal(afterSecond.refs.length, afterFirst.refs.length);
  assert.equal(afterSecond.summaries.length, afterFirst.summaries.length);

  // Authenticated Brain preview should read the saved analysis rather than infer Vision again.
  const brainResponse = await ownerPage.context().request.post(`${base}/api/ai-engine/preview`, {
    data: { characterId: "mar", situation: "comment", postId },
  });
  assert.equal(brainResponse.status(), 200, "Brain route must consume the persisted Vision context");
  const brain = await brainResponse.json();
  assert.equal(brain.contextAudit.visionMediaIncluded, 2);
  assert.equal(brain.contextAudit.visionPostSummariesIncluded, 1);
  assert.ok(brain.attempts.every((attempt: any) => attempt.model.endsWith(":free")));

  // The real autonomy test-preview is dry-run only and reads the same persisted context.
  const settingsSaved = await ownerPage.context().request.put(`${base}/api/autonomy/settings`, {
    data: { globalKillSwitchEngaged: true },
  });
  assert.equal(settingsSaved.status(), 200);
  const settingsResponse = await ownerPage.context().request.get(`${base}/api/autonomy/settings`);
  assert.equal(settingsResponse.status(), 200);
  const settings = await settingsResponse.json();
  assert.equal(settings.liveExecutionEnabled, false);
  assert.equal(settings.characters.find((item: any) => item.characterId === "mar")?.enabled, false);
  const autonomyResponse = await ownerPage.context().request.post(`${base}/api/autonomy/test-preview`, {
    data: { characterId: "mar", idempotencyKey: randomUUID(), situation: "like_post", targetId: postId },
  });
  assert.equal(autonomyResponse.status(), 200, "autonomy preview must run through its authenticated dry-run route");
  const autonomy = await autonomyResponse.json();
  assert.equal(autonomy.executed, false);
  assert.equal(autonomy.socialActionsExecuted, false);
  assert.equal(autonomy.preview.contextAudit.visionMediaIncluded, 2);
  assert.equal(autonomy.preview.contextAudit.visionPostSummariesIncluded, 1);

  const afterAllPreviews = await envelope(ownerPage);
  assert.equal(afterAllPreviews.revision, baselineRevision, "analysis and previews must not write the social universe");
  assert.deepEqual(afterAllPreviews.state, baselineState);
  const finalRows = await queryVisionRows(ownerId, postId);
  assert.equal(finalRows.analyses.length, 2, "Brain and autonomy must not repeat Vision inference per character");
  assert.ok(finalRows.analyses.every((row: any) => row.model.endsWith(":free")));
  const otherRefs = await db.select().from(echoVisionMediaRefsTable)
    .where(eq(echoVisionMediaRefsTable.ownerId, otherOwnerId));
  assert.equal(otherRefs.length, 0, "owner isolation must prevent any foreign Vision references");

  report = {
    result: "PASS",
    disposableOwners: 2,
    authenticatedVisionRoute: "PASS",
    ownerIsolation: "PASS",
    carousel: "PASS",
    visionInference: firstResult.items.map((item: any) => ({
      provider: item.provider,
      model: item.model,
      position: item.position,
      description: item.analysis.sceneDescription,
      colors: item.analysis.dominantColors,
      validated: true,
      cost: item.usage.cost,
      acceptedFreeAttempts: item.attempts.filter((attempt: any) => attempt.outcome === "accepted")
        .map((attempt: any) => ({ model: attempt.model, cost: attempt.usage.cost })),
    })),
    deduplication: {
      secondRequestCacheHit: true,
      secondRequestProviderAttempts: secondResult.items.reduce((sum: number, item: any) => sum + item.attempts.length, 0),
      storedAnalyses: finalRows.analyses.length,
    },
    brain: { contextVisionMedia: brain.contextAudit.visionMediaIncluded, contextPostSummaries: brain.contextAudit.visionPostSummariesIncluded },
    autonomy: { contextVisionMedia: autonomy.preview.contextAudit.visionMediaIncluded,
      contextPostSummaries: autonomy.preview.contextAudit.visionPostSummariesIncluded,
      executed: autonomy.executed, socialActionsExecuted: autonomy.socialActionsExecuted },
    socialUniverseUnchanged: true,
    liveExecutionEnabled: settings.liveExecutionEnabled,
  };
} catch (error) {
  report = { result: "FAIL", error: safeError(error) };
  process.exitCode = 1;
} finally {
  cleanupSucceeded = true;
  for (const page of ownerPages.values()) {
    try { await page.context().close(); } catch {}
  }
  try { await browser?.close(); } catch {}
  for (const ownerId of createdOwners) {
    try {
      await db.delete(echoVisionMediaRefsTable).where(eq(echoVisionMediaRefsTable.ownerId, ownerId));
      await db.delete(echoVisionPostSummariesTable).where(eq(echoVisionPostSummariesTable.ownerId, ownerId));
      await db.delete(echoVisionAnalysesTable).where(eq(echoVisionAnalysesTable.ownerId, ownerId));
      await db.delete(echoAutonomyRunsTable).where(eq(echoAutonomyRunsTable.ownerId, ownerId));
      await db.delete(echoAutonomyCharactersTable).where(eq(echoAutonomyCharactersTable.ownerId, ownerId));
      await db.delete(echoAutonomyOwnersTable).where(eq(echoAutonomyOwnersTable.ownerId, ownerId));
      const files = await db.select().from(echoMediaTable).where(eq(echoMediaTable.ownerId, ownerId));
      const storage = new ObjectStorageService();
      for (const file of files) {
        await (await storage.getObjectEntityFile(file.objectPath)).delete({ ignoreNotFound: true });
      }
      await db.delete(echoMediaTable).where(eq(echoMediaTable.ownerId, ownerId));
      await db.delete(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId));
      await clerkClient.users.deleteUser(ownerId);
      const remainingAnalysis = await db.select({ id: echoVisionAnalysesTable.id })
        .from(echoVisionAnalysesTable).where(eq(echoVisionAnalysesTable.ownerId, ownerId));
      const remainingRefs = await db.select({ ownerId: echoVisionMediaRefsTable.ownerId })
        .from(echoVisionMediaRefsTable).where(eq(echoVisionMediaRefsTable.ownerId, ownerId));
      const remainingSummaries = await db.select({ ownerId: echoVisionPostSummariesTable.ownerId })
        .from(echoVisionPostSummariesTable).where(eq(echoVisionPostSummariesTable.ownerId, ownerId));
      const remainingMedia = await db.select({ ownerId: echoMediaTable.ownerId })
        .from(echoMediaTable).where(eq(echoMediaTable.ownerId, ownerId));
      const remainingUniverse = await db.select({ ownerId: echoUniversesTable.ownerId })
        .from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId));
      if (remainingAnalysis.length || remainingRefs.length || remainingSummaries.length
        || remainingMedia.length || remainingUniverse.length) cleanupSucceeded = false;
    } catch {
      cleanupSucceeded = false;
      continue;
    }
  }
  report.cleanupSucceeded = cleanupSucceeded;
  console.log(JSON.stringify(report, null, 2));
  await pool.end();
}

if (!cleanupSucceeded) process.exitCode = 1;
