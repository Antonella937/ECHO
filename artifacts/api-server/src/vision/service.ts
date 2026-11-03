import { createHash, randomUUID } from "node:crypto";
import { and, eq, inArray, or } from "drizzle-orm";
import { db, echoMediaTable, echoVisionAnalysesTable, echoVisionMediaRefsTable, echoVisionPostSummariesTable } from "@workspace/db";
import type { CharacterDecisionInput, SocialState } from "@workspace/api-zod";
import { ObjectPermission } from "../lib/objectAcl";
import { ObjectStorageService } from "../lib/objectStorage";
import { validMediaHeader } from "../lib/mediaSafety";
import {
  VisionAnalysisSchema,
  VisionError,
  type VisionAnalysis,
  type VisionContext,
  type VisionEntityType,
  type VisionPostSummary,
  type VisionProvider,
} from "./contracts";
import { OpenRouterVisionProvider } from "./openrouter";

const MAX_IMAGE_BYTES = 15 * 1024 * 1024;
const IMAGE_MIMES = new Set(["image/jpeg", "image/png", "image/webp"]);
const visionProvider = new OpenRouterVisionProvider();
const objectStorage = new ObjectStorageService();

interface MediaItem {
  id: string;
  type: "image" | "video";
  url: string;
  mimeType?: string;
  position: number;
}

interface AnalysisResult {
  mediaId: string;
  position: number;
  analysisId: string;
  analysis: VisionAnalysis;
  provider: string;
  model: string;
  cacheHit: boolean;
  attempts: Array<{ model: string; outcome: "accepted" | "rejected"; errorCode: string | null; usage: { promptTokens: number | null; completionTokens: number | null; cost: number | null } }>;
  usage: { promptTokens: number | null; completionTokens: number | null; cost: number | null };
}

function mediaItems(post: SocialState["posts"][number]): MediaItem[] {
  const raw = post.media?.length
    ? post.media
    : post.image?.trim()
      ? [{ id: `${post.id}:legacy`, type: "image" as const, url: post.image }]
      : [];
  return raw.map((item, position) => ({ ...item, position }));
}

function analysisKey(entityType: VisionEntityType, entityId: string, mediaId: string): string {
  return `${entityType}:${entityId}:${mediaId}`;
}

function safeImagePath(path: string): boolean {
  return /^\/objects\/uploads\/[a-f0-9-]{20,}$/i.test(path);
}

function hashImage(mimeType: string, bytes: Buffer): string {
  return createHash("sha256").update(mimeType).update("\0").update(bytes).digest("hex");
}

function hashPost(items: Array<{ id: string; type: string; path: string }>, caption: string, location: string): string {
  return createHash("sha256").update(JSON.stringify({ items, caption, location })).digest("hex");
}

function parseStoredAnalysis(value: unknown): VisionAnalysis | null {
  const parsed = VisionAnalysisSchema.safeParse(value);
  return parsed.success ? parsed.data : null;
}

async function ownedImage(ownerId: string, item: MediaItem): Promise<{ bytes: Buffer; mimeType: string; contentHash: string }> {
  if (item.type !== "image") throw new VisionError("VISION_VIDEO_NOT_SUPPORTED", 415);
  if (!safeImagePath(item.url)) throw new VisionError("VISION_MEDIA_NOT_PRIVATE_UPLOAD", 422);
  const [row] = await db.select({ objectPath: echoMediaTable.objectPath })
    .from(echoMediaTable)
    .where(and(eq(echoMediaTable.objectPath, item.url), eq(echoMediaTable.ownerId, ownerId)))
    .limit(1);
  if (!row) throw new VisionError("VISION_MEDIA_NOT_OWNED", 404);

  let file;
  try { file = await objectStorage.getObjectEntityFile(row.objectPath); }
  catch { throw new VisionError("VISION_MEDIA_NOT_FOUND", 404); }
  const allowed = await objectStorage.canAccessObjectEntity({
    userId: ownerId,
    objectFile: file,
    requestedPermission: ObjectPermission.READ,
  }).catch(() => false);
  if (!allowed) throw new VisionError("VISION_MEDIA_ACCESS_DENIED", 403);

  let metadata: Record<string, unknown>;
  try {
    const [rawMetadata] = await file.getMetadata();
    metadata = rawMetadata as Record<string, unknown>;
  } catch { throw new VisionError("VISION_MEDIA_READ_FAILED", 502); }
  const mimeType = String(metadata.contentType ?? "").split(";")[0].trim().toLowerCase();
  const size = Number(metadata.size ?? 0);
  if (!IMAGE_MIMES.has(mimeType) || size < 1 || size > MAX_IMAGE_BYTES)
    throw new VisionError("VISION_IMAGE_FORMAT_OR_SIZE_INVALID", 415);
  let bytes: Buffer;
  try {
    const [downloaded] = await file.download({ validation: false });
    bytes = downloaded;
  } catch { throw new VisionError("VISION_MEDIA_READ_FAILED", 502); }
  if (bytes.length > MAX_IMAGE_BYTES) throw new VisionError("VISION_IMAGE_FORMAT_OR_SIZE_INVALID", 415);
  if (!validMediaHeader(bytes, mimeType)) throw new VisionError("VISION_IMAGE_HEADER_INVALID", 415);
  return { bytes, mimeType, contentHash: hashImage(mimeType, bytes) };
}

async function claimAnalysis(ownerId: string, input: {
  contentHash: string; mimeType: string; byteSize: number;
}): Promise<{ id: string; cache: VisionAnalysis | null; provider: string; model: string }> {
  const read = async () => {
    const [row] = await db.select().from(echoVisionAnalysesTable)
      .where(and(eq(echoVisionAnalysesTable.ownerId, ownerId), eq(echoVisionAnalysesTable.contentHash, input.contentHash)))
      .limit(1);
    return row;
  };
  let row = await read();
  if (row?.status === "complete") {
    const analysis = parseStoredAnalysis(row.analysis);
    if (analysis) return { id: row.id, cache: analysis, provider: row.provider ?? "cached", model: row.model ?? "cached" };
    // A malformed stored result is not trusted or silently returned.
    await db.update(echoVisionAnalysesTable)
      .set({ status: "failed", errorCode: "STORED_ANALYSIS_INVALID", updatedAt: new Date() })
      .where(and(eq(echoVisionAnalysesTable.id, row.id), eq(echoVisionAnalysesTable.ownerId, ownerId)));
    row = await read();
  }
  if (row?.status === "pending") throw new VisionError("VISION_ANALYSIS_IN_PROGRESS", 409);

  if (row?.status === "failed") {
    const claimed = await db.update(echoVisionAnalysesTable)
      .set({ status: "pending", errorCode: null, provider: null, model: null, analysis: null, updatedAt: new Date() })
      .where(and(eq(echoVisionAnalysesTable.id, row.id), eq(echoVisionAnalysesTable.ownerId, ownerId), eq(echoVisionAnalysesTable.status, "failed")))
      .returning({ id: echoVisionAnalysesTable.id });
    if (claimed[0]) return { id: row.id, cache: null, provider: "", model: "" };
    row = await read();
    if (row?.status === "complete") {
      const analysis = parseStoredAnalysis(row.analysis);
      if (analysis) return { id: row.id, cache: analysis, provider: row.provider ?? "cached", model: row.model ?? "cached" };
    }
    throw new VisionError("VISION_ANALYSIS_IN_PROGRESS", 409);
  }

  const id = randomUUID();
  const inserted = await db.insert(echoVisionAnalysesTable).values({
    id, ownerId, contentHash: input.contentHash, mimeType: input.mimeType, byteSize: input.byteSize,
    status: "pending", updatedAt: new Date(),
  }).onConflictDoNothing().returning({ id: echoVisionAnalysesTable.id });
  if (inserted[0]) return { id, cache: null, provider: "", model: "" };
  row = await read();
  if (row?.status === "complete") {
    const analysis = parseStoredAnalysis(row.analysis);
    if (analysis) return { id: row.id, cache: analysis, provider: row.provider ?? "cached", model: row.model ?? "cached" };
  }
  throw new VisionError(row?.status === "pending" ? "VISION_ANALYSIS_IN_PROGRESS" : "VISION_ANALYSIS_CLAIM_CONFLICT", 409);
}

async function persistReference(ownerId: string, entityType: VisionEntityType, entityId: string, item: MediaItem, contentHash: string): Promise<void> {
  await db.insert(echoVisionMediaRefsTable).values({
    ownerId, entityType, entityId, mediaId: item.id, position: item.position, contentHash, sourcePath: item.url,
  }).onConflictDoUpdate({
    target: [echoVisionMediaRefsTable.ownerId, echoVisionMediaRefsTable.entityType, echoVisionMediaRefsTable.entityId, echoVisionMediaRefsTable.mediaId],
    set: { position: item.position, contentHash, sourcePath: item.url },
  });
}

async function analyzeOne(
  ownerId: string,
  entityType: VisionEntityType,
  entityId: string,
  item: MediaItem,
  provider: VisionProvider,
): Promise<AnalysisResult> {
  const image = await ownedImage(ownerId, item);
  const claim = await claimAnalysis(ownerId, {
    contentHash: image.contentHash, mimeType: image.mimeType, byteSize: image.bytes.length,
  });
  await persistReference(ownerId, entityType, entityId, item, image.contentHash);
  if (claim.cache) {
    return {
      mediaId: item.id, position: item.position, analysisId: claim.id, analysis: claim.cache,
      provider: claim.provider, model: claim.model, cacheHit: true, attempts: [],
      usage: { promptTokens: null, completionTokens: null, cost: null },
    };
  }

  try {
    const outcome = await provider.analyze({
      image: { mimeType: image.mimeType, base64: image.bytes.toString("base64") },
      prompt: [
        "Analiza esta foto para contexto social, sin identificar personas.",
        "Devuelve exactamente este JSON: {\"sceneDescription\":\"descripción observable\",\"setting\":\"lugar o contexto visible\",\"objects\":[{\"label\":\"elemento\",\"category\":\"object|person|animal|text|setting|other\",\"attributes\":[\"rasgo visible\"],\"position\":\"foreground|center|background|left|right|top|bottom|unknown\",\"confidence\":0.0}],\"people\":{\"count\":0,\"nonIdentifyingDetails\":[\"acción o ubicación visible, sin identidad ni rasgos sensibles\"]},\"activities\":[],\"dominantColors\":[],\"visibleText\":[],\"notableDetails\":[],\"uncertainty\":[]}.",
        "No inventes eventos fuera de la imagen; conserva nombres de elementos concretos y expresa dudas en uncertainty.",
      ].join("\n"),
      validate: parseStoredAnalysisOrThrow,
    });
    await db.update(echoVisionAnalysesTable).set({
      status: "complete", provider: outcome.provider, model: outcome.model, analysis: outcome.analysis,
      errorCode: null, updatedAt: new Date(),
    }).where(and(eq(echoVisionAnalysesTable.id, claim.id), eq(echoVisionAnalysesTable.ownerId, ownerId), eq(echoVisionAnalysesTable.status, "pending")));
    return {
      mediaId: item.id, position: item.position, analysisId: claim.id, analysis: outcome.analysis,
      provider: outcome.provider, model: outcome.model, cacheHit: false, attempts: outcome.attempts, usage: outcome.usage,
    };
  } catch (error) {
    const code = error instanceof VisionError ? error.code : "VISION_ANALYSIS_FAILED";
    await db.update(echoVisionAnalysesTable)
      .set({ status: "failed", errorCode: code, updatedAt: new Date() })
      .where(and(eq(echoVisionAnalysesTable.id, claim.id), eq(echoVisionAnalysesTable.ownerId, ownerId), eq(echoVisionAnalysesTable.status, "pending")));
    if (error instanceof VisionError) throw error;
    throw new VisionError("VISION_ANALYSIS_FAILED", 502);
  }
}

function parseStoredAnalysisOrThrow(text: string): VisionAnalysis {
  let value: unknown;
  try {
    const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    value = JSON.parse(normalized);
  } catch { throw new VisionError("INVALID_VISION_JSON"); }
  const parsed = VisionAnalysisSchema.safeParse(value);
  if (!parsed.success) throw new VisionError("INVALID_VISION_STRUCTURE");
  if (/(?:sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{12,})/i.test(JSON.stringify(parsed.data)))
    throw new VisionError("SENSITIVE_OUTPUT_REJECTED");
  return parsed.data;
}

export function buildVisionPostSummary(postId: string, caption: string,
  images: Array<Pick<AnalysisResult, "mediaId" | "position" | "analysis">>,
  unsupportedImageCount = 0, unsupportedVideoCount = 0): VisionPostSummary {
  const orderedItems = [...images].sort((a, b) => a.position - b.position).map((entry) => ({
    mediaId: entry.mediaId,
    position: entry.position,
    description: entry.analysis.sceneDescription,
    objects: entry.analysis.objects.map((item) => item.label).slice(0, 12),
    colors: entry.analysis.dominantColors.slice(0, 8),
  }));
  const overallDescription = [
    `Carrusel con ${orderedItems.length} foto${orderedItems.length === 1 ? "" : "s"} en orden.`,
    ...orderedItems.map((item) => `Foto ${item.position + 1}: ${item.description}`),
    unsupportedImageCount ? `${unsupportedImageCount} imagen${unsupportedImageCount === 1 ? "" : "es"} no disponible${unsupportedImageCount === 1 ? "" : "s"} para análisis privado.` : "",
    unsupportedVideoCount ? `${unsupportedVideoCount} elemento${unsupportedVideoCount === 1 ? "" : "s"} de video sin analizar.` : "",
    caption ? `Caption: ${caption.slice(0, 500)}` : "",
  ].filter(Boolean).join(" ");
  return {
    postId, caption: caption.slice(0, 500), imageCount: orderedItems.length,
    unsupportedImageCount, unsupportedVideoCount, orderedItems, overallDescription,
  };
}

export class VisionService {
  constructor(private readonly provider: VisionProvider = visionProvider) {}

  async analyzePost(ownerId: string, state: SocialState, postId: string) {
    if (!ownerId) throw new VisionError("AUTHENTICATION_REQUIRED", 401);
    const post = state.posts.find((item) => item.id === postId);
    if (!post) throw new VisionError("POST_NOT_FOUND", 404);
    const items = mediaItems(post);
    if (!items.length) throw new VisionError("POST_HAS_NO_MEDIA", 422);
    const allImageItems = items.filter((item) => item.type === "image");
    const imageItems = allImageItems.filter((item) => safeImagePath(item.url));
    const videoItems = items.filter((item) => item.type === "video");
    if (!imageItems.length) throw new VisionError("POST_HAS_NO_IMAGE_MEDIA", 415);

    const results: AnalysisResult[] = [];
    for (const item of imageItems) results.push(await analyzeOne(ownerId, "post", post.id, item, this.provider));

    const overallHash = hashPost(items.map((item) => ({ id: item.id, type: item.type, path: item.url })),
      post.caption ?? "", post.location ?? "");
    const summary = buildVisionPostSummary(post.id, post.caption ?? "", results,
      allImageItems.length - imageItems.length, videoItems.length);
    await db.insert(echoVisionPostSummariesTable).values({
      ownerId, postId: post.id, contentHash: overallHash,
      summary: summary as unknown as Record<string, unknown>, updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [echoVisionPostSummariesTable.ownerId, echoVisionPostSummariesTable.postId, echoVisionPostSummariesTable.contentHash],
      set: { summary: summary as unknown as Record<string, unknown>, updatedAt: new Date() },
    });

    return {
      entityType: "post" as const,
      entityId: post.id,
      summary,
      items: results.map(({ mediaId, position, analysisId, analysis, provider, model, cacheHit, attempts, usage }) =>
        ({ mediaId, position, analysisId, analysis, provider, model, cacheHit, attempts, usage })),
      skippedVideoCount: videoItems.length,
    };
  }

  async analyzeStory(ownerId: string, state: SocialState, storyId: string) {
    if (!ownerId) throw new VisionError("AUTHENTICATION_REQUIRED", 401);
    const story = state.stories.find((item) => item.id === storyId);
    if (!story) throw new VisionError("STORY_NOT_FOUND", 404);
    const item: MediaItem = { id: `story:${story.id}`, type: "image", url: story.image, position: 0 };
    const result = await analyzeOne(ownerId, "story", story.id, item, this.provider);
    return {
      entityType: "story" as const,
      entityId: story.id,
      items: [{ mediaId: result.mediaId, position: result.position, analysisId: result.analysisId,
        analysis: result.analysis, provider: result.provider, model: result.model, cacheHit: result.cacheHit,
        attempts: result.attempts, usage: result.usage }],
    };
  }

  async ensureForDecision(ownerId: string, state: SocialState, input: CharacterDecisionInput): Promise<VisionContext> {
    if (input.postId) {
      try { await this.analyzePost(ownerId, state, input.postId); }
      catch (error) {
        // Existing posts using bundled/legacy media remain usable by the Brain;
        // only persisted private uploads are eligible for first-time Vision analysis.
        if (!(error instanceof VisionError) || !["POST_HAS_NO_IMAGE_MEDIA"].includes(error.code)) throw error;
      }
    }
    if (input.storyId) {
      try { await this.analyzeStory(ownerId, state, input.storyId); }
      catch (error) {
        if (!(error instanceof VisionError) || error.code !== "VISION_MEDIA_NOT_PRIVATE_UPLOAD") throw error;
      }
    }
    return this.loadContext(ownerId, state, input);
  }

  async loadContext(ownerId: string, state: SocialState, input: CharacterDecisionInput): Promise<VisionContext> {
    const relevantPosts = state.posts.filter((post) =>
      post.authorId === input.characterId || post.taggedAccountIds?.includes(input.characterId) || post.id === input.postId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 6);
    const relevantStories = state.stories.filter((story) =>
      story.authorId === input.characterId || story.mentionedAccountIds?.includes(input.characterId) || story.id === input.storyId)
      .sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime()).slice(0, 4);
    const postIds = relevantPosts.map((post) => post.id);
    const storyIds = relevantStories.map((story) => story.id);
    const entityFilters = [
      ...(postIds.length ? [and(eq(echoVisionMediaRefsTable.entityType, "post"), inArray(echoVisionMediaRefsTable.entityId, postIds))] : []),
      ...(storyIds.length ? [and(eq(echoVisionMediaRefsTable.entityType, "story"), inArray(echoVisionMediaRefsTable.entityId, storyIds))] : []),
    ];
    const refs = entityFilters.length
      ? await db.select().from(echoVisionMediaRefsTable).where(and(
        eq(echoVisionMediaRefsTable.ownerId, ownerId), or(...entityFilters)!,
      ))
      : [];
    const hashes = [...new Set(refs.map((ref) => ref.contentHash))];
    const analysisRows = hashes.length
      ? await db.select().from(echoVisionAnalysesTable).where(and(
        eq(echoVisionAnalysesTable.ownerId, ownerId),
        inArray(echoVisionAnalysesTable.contentHash, hashes),
        eq(echoVisionAnalysesTable.status, "complete"),
      ))
      : [];
    const analysesByHash = new Map(analysisRows.map((row) => [row.contentHash, parseStoredAnalysis(row.analysis)]));
    const analyses: VisionContext["analyses"] = {};
    const sourcePaths = new Map<string, string>();
    for (const post of relevantPosts) {
      for (const item of mediaItems(post)) sourcePaths.set(analysisKey("post", post.id, item.id), item.url);
    }
    for (const story of relevantStories) {
      sourcePaths.set(analysisKey("story", story.id, `story:${story.id}`), story.image);
    }
    for (const ref of refs) {
      const refKey = analysisKey(ref.entityType, ref.entityId, ref.mediaId);
      if (sourcePaths.get(refKey) !== ref.sourcePath) continue;
      const result = analysesByHash.get(ref.contentHash);
      if (result) analyses[refKey] = result;
    }
    const summaries = postIds.length
      ? await db.select().from(echoVisionPostSummariesTable).where(and(
        eq(echoVisionPostSummariesTable.ownerId, ownerId),
        inArray(echoVisionPostSummariesTable.postId, postIds),
      ))
      : [];
    const postSummaries: VisionContext["postSummaries"] = {};
    for (const row of summaries) {
      const post = relevantPosts.find((item) => item.id === row.postId);
      if (!post) continue;
      const expectedHash = hashPost(mediaItems(post).map((item) => ({ id: item.id, type: item.type, path: item.url })),
        post.caption ?? "", post.location ?? "");
      if (row.contentHash === expectedHash && row.summary && typeof row.summary === "object")
        postSummaries[row.postId] = row.summary as unknown as VisionPostSummary;
    }
    return { analyses, postSummaries };
  }
}

export const visionService = new VisionService();
