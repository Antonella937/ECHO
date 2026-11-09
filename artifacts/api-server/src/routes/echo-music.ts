import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { db, echoMediaTable, echoMusicLibraryTable } from "@workspace/db";
import { and, desc, eq, isNotNull } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { pipeMedia } from "../lib/pipeMedia";

/**
 * ECHO Music add-on: offline preparation only.
 * Music is independent of Free / Plus / Premium, voice credits, and commercial
 * music playback. No paid provider calls or external transfer are possible here.
 */
const musicDraft = z.object({
  title: z.string().trim().min(1).max(120),
  description: z.string().trim().min(3).max(2000),
  genre: z.string().trim().max(100).default(""),
  mood: z.string().trim().max(100).default(""),
  instruments: z.array(z.string().trim().min(1).max(80)).max(12).default([]),
  language: z.string().trim().min(2).max(20).default("en"),
  vocalMode: z.enum(["instrumental", "singing"]).default("instrumental"),
  lyrics: z.string().max(5000).default(""),
  characterId: z.string().min(1).max(128).optional(),
}).strict();

const router: IRouter = Router();
router.use("/music", requireAuth, (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

const libraryItem = z.object({
  id: z.string().uuid(),
  characterId: z.string().min(1).max(128),
  title: z.string().trim().min(1).max(120),
  prompt: z.string().max(5000).default(""),
  durationSeconds: z.number().int().min(0).max(3600),
  status: z.enum(["draft", "saved_audio"]),
  audioPath: z.string().max(500).nullable().optional(),
}).strict().refine(item => item.status !== "saved_audio" || !!item.audioPath);
router.get("/music/library", async (req, res) => {
  try {
    const items = await db.select().from(echoMusicLibraryTable)
      .where(eq(echoMusicLibraryTable.ownerId, req.userId!))
      .orderBy(desc(echoMusicLibraryTable.createdAt)).limit(100);
    res.json({ items });
  } catch (error) {
    req.log.error({ err: error }, "Music library read failed");
    res.status(503).json({ error: "MUSIC_LIBRARY_UNAVAILABLE" });
  }
});
router.post("/music/library", async (req, res) => {
  const parsed = libraryItem.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_MUSIC_LIBRARY_ITEM" }); return; }
  const item = parsed.data;
  if (item.audioPath) {
    if (!item.audioPath.startsWith("/objects/uploads/") || !/^\/objects\/uploads\/[a-f0-9-]+$/i.test(item.audioPath)) {
      res.status(400).json({ error: "INVALID_AUDIO_PATH" }); return;
    }
    const [owned] = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable)
      .where(and(eq(echoMediaTable.objectPath, item.audioPath), eq(echoMediaTable.ownerId, req.userId!))).limit(1);
    if (!owned) { res.status(403).json({ error: "AUDIO_NOT_OWNED" }); return; }
  }
  try {
    const [saved] = await db.insert(echoMusicLibraryTable).values({
      ownerId: req.userId!, id: item.id, characterId: item.characterId,
      title: item.title, prompt: item.prompt, durationSeconds: item.durationSeconds,
      status: item.status, audioPath: item.audioPath ?? null,
    }).onConflictDoUpdate({
      target: [echoMusicLibraryTable.ownerId, echoMusicLibraryTable.id],
      set: { title: item.title, prompt: item.prompt, durationSeconds: item.durationSeconds,
        status: item.status, audioPath: item.audioPath ?? null },
    }).returning();
    res.json({ item: saved });
  } catch (error) {
    req.log.error({ err: error }, "Music library save failed");
    res.status(503).json({ error: "MUSIC_LIBRARY_UNAVAILABLE" });
  }
});
router.delete("/music/library/:id", async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_MUSIC_ID" }); return; }
  try {
    await db.delete(echoMusicLibraryTable).where(and(
      eq(echoMusicLibraryTable.ownerId, req.userId!), eq(echoMusicLibraryTable.id, parsed.data)));
    res.json({ deleted: true, audioFileDeleted: false });
  } catch (error) {
    req.log.error({ err: error }, "Music library delete failed");
    res.status(503).json({ error: "MUSIC_LIBRARY_UNAVAILABLE" });
  }
});

// Publishing is explicit. Library files stay private unless published by their owner.
router.post("/music/library/:id/publish", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "INVALID_MUSIC_ID" }); return; }
  try {
    const [track] = await db.select().from(echoMusicLibraryTable).where(and(
      eq(echoMusicLibraryTable.ownerId, req.userId!), eq(echoMusicLibraryTable.id, id.data))).limit(1);
    if (!track || track.status !== "saved_audio" || !track.audioPath) {
      res.status(404).json({ error: "SAVED_AUDIO_REQUIRED" }); return;
    }
    const [owned] = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable).where(and(
      eq(echoMediaTable.objectPath, track.audioPath), eq(echoMediaTable.ownerId, req.userId!))).limit(1);
    if (!owned) { res.status(403).json({ error: "AUDIO_NOT_OWNED" }); return; }
    const [published] = await db.update(echoMusicLibraryTable).set({ publishedAt: new Date() }).where(and(
      eq(echoMusicLibraryTable.ownerId, req.userId!), eq(echoMusicLibraryTable.id, id.data))).returning();
    res.json({ item: published });
  } catch (error) { req.log.error({ err: error }, "Music publish failed"); res.status(503).json({ error: "MUSIC_PUBLISH_UNAVAILABLE" }); }
});
router.post("/music/library/:id/unpublish", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "INVALID_MUSIC_ID" }); return; }
  try {
    await db.update(echoMusicLibraryTable).set({ publishedAt: null }).where(and(
      eq(echoMusicLibraryTable.ownerId, req.userId!), eq(echoMusicLibraryTable.id, id.data)));
    res.json({ unpublished: true });
  } catch (error) { req.log.error({ err: error }, "Music unpublish failed"); res.status(503).json({ error: "MUSIC_UNPUBLISH_UNAVAILABLE" }); }
});
router.get("/music/published", async (req, res) => {
  try {
    const items = await db.select({
      id: echoMusicLibraryTable.id, characterId: echoMusicLibraryTable.characterId,
      title: echoMusicLibraryTable.title, durationSeconds: echoMusicLibraryTable.durationSeconds,
      publishedAt: echoMusicLibraryTable.publishedAt,
    }).from(echoMusicLibraryTable).where(isNotNull(echoMusicLibraryTable.publishedAt))
      .orderBy(desc(echoMusicLibraryTable.publishedAt)).limit(100);
    res.json({ items });
  } catch (error) { req.log.error({ err: error }, "Published music listing failed"); res.status(503).json({ error: "MUSIC_CATALOG_UNAVAILABLE" }); }
});
router.get("/music/published/:id/audio", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "INVALID_MUSIC_ID" }); return; }
  try {
    const [track] = await db.select().from(echoMusicLibraryTable).where(and(
      eq(echoMusicLibraryTable.id, id.data), isNotNull(echoMusicLibraryTable.publishedAt))).limit(1);
    if (!track?.audioPath) { res.status(404).json({ error: "TRACK_NOT_PUBLISHED" }); return; }
    const [media] = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable).where(and(
      eq(echoMediaTable.objectPath, track.audioPath), eq(echoMediaTable.ownerId, track.ownerId))).limit(1);
    if (!media) { res.status(404).json({ error: "AUDIO_NOT_FOUND" }); return; }
    const storage = new ObjectStorageService();
    const file = await storage.getObjectEntityFile(media.objectPath);
    const response = await storage.downloadObject(file, 0, req.headers.range);
    response.headers.forEach((value, key) => res.setHeader(key, value));
    res.setHeader("Cache-Control", "private, no-store");
    res.status(response.status);
    if (response.body) pipeMedia(response.body, res, error => req.log.warn({ err: error }, "Music stream interrupted"));
    else res.end();
  } catch (error) { req.log.error({ err: error }, "Music stream failed"); if (!res.headersSent) res.status(503).json({ error: "MUSIC_STREAM_UNAVAILABLE" }); }
});

// ECHO Music commercial configuration. Read-only until a verified provider,
// subscription billing, and an atomic server-side credit ledger are enabled.
const MUSIC_PLAN = Object.freeze({
  monthlyUsd: 9.99,
  manualGenerationsPerMonth: 10,
  autonomousGenerationsPerMonth: 1,
  autonomousCooldownDays: 7,
  purchasedCreditsExpire: false,
  autonomousPacks: [
    { generations: 1, priceUsd: 0.99 },
    { generations: 3, priceUsd: 2.49 },
    { generations: 5, priceUsd: 3.99 },
  ],
});
router.get("/music/plan", (_req, res) => {
  res.json({ plan: MUSIC_PLAN, billingEnabled: false, generationEnabled: false,
    autonomousGenerationEnabled: false, purchasesEnabled: false,
    providerValidationPending: true });
});

router.get("/music/status", (_req, res) => {
  res.json({
    addon: "echo_music",
    addonRequired: true,
    activated: false,
    generationEnabled: false,
    provider: "fal_ai_mureka_v8",
    model: "mureka/v8/generate/song",
    providerConfigured: Boolean(process.env.FAL_KEY?.trim()),
    providerRequestsEnabled: false,
    paidCallsMade: 0,
    creditsSharedWithVoices: false,
    commercialMusicPlaybackSeparate: true,
    features: {
      instrumental: true,
      vocals: true,
      lyrics: true,
      characterSingingVoice: "pending_provider_validation",
      publishAndShare: "pending",
    },
  });
});

router.post("/music/prepare", (req, res) => {
  const parsed = musicDraft.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_MUSIC_DRAFT", details: parsed.error.flatten().fieldErrors });
    return;
  }
  const draft = parsed.data;
  res.json({
    status: "preview_only",
    generationEnabled: false,
    paidCallsMade: 0,
    addonRequired: true,
    draft,
    providerPrompt: [
      draft.description,
      draft.genre && `Genre: ${draft.genre}`,
      draft.mood && `Mood: ${draft.mood}`,
      draft.instruments.length && `Instruments: ${draft.instruments.join(", ")}`,
      `Vocals: ${draft.vocalMode === "instrumental" ? "instrumental only" : `singing in ${draft.language}`}`,
      draft.vocalMode === "singing" && draft.lyrics && `Original lyrics:\n${draft.lyrics}`,
    ].filter(Boolean).join("\n"),
    note: "No music was generated, uploaded, published, or billed.",
  });
});


// Public YouTube search uses the server-side API key. No Google account connection,
// music playback, downloading, or paid music generation occurs in this endpoint.
const youtubeSearchQuery = z.object({
  q: z.string().trim().min(3).max(100),
});
router.get("/music/youtube/search", async (req, res) => {
  const parsed = youtubeSearchQuery.safeParse(req.query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_SEARCH_QUERY" });
    return;
  }
  const apiKey = process.env.YOUTUBE_API_KEY?.trim();
  if (!apiKey) {
    res.status(503).json({ error: "YOUTUBE_SEARCH_NOT_CONFIGURED" });
    return;
  }
  try {
    const url = new URL("https://www.googleapis.com/youtube/v3/search");
    url.searchParams.set("part", "snippet");
    url.searchParams.set("type", "video");
    url.searchParams.set("videoEmbeddable", "true");
    url.searchParams.set("maxResults", "10");
    url.searchParams.set("q", parsed.data.q);
    const response = await fetch(url, {
      headers: { "X-goog-api-key": apiKey },
      signal: AbortSignal.timeout(8000),
    });
    if (!response.ok) {
      res.status(response.status === 403 || response.status === 429 ? 503 : 502)
        .json({ error: "YOUTUBE_SEARCH_UNAVAILABLE" });
      return;
    }
    const data = await response.json() as {
      items?: Array<{ id?: { videoId?: string }; snippet?: { title?: string; channelTitle?: string; thumbnails?: { medium?: { url?: string } } } }>;
    };
    const items = (data.items ?? []).flatMap((item) => {
      const videoId = item.id?.videoId;
      if (!videoId || !/^[a-zA-Z0-9_-]{11}$/.test(videoId)) return [];
      return [{
        videoId,
        title: item.snippet?.title ?? "",
        artist: item.snippet?.channelTitle ?? "",
        thumbnailUrl: item.snippet?.thumbnails?.medium?.url ?? null,
        watchUrl: "https://www.youtube.com/watch?v=" + videoId,
      }];
    });
    res.json({ items, playbackEnabled: false, audioExtractionAllowed: false });
  } catch {
    res.status(502).json({ error: "YOUTUBE_SEARCH_UNAVAILABLE" });
  }
});


// Feed.fm Clips is a prospective licensed provider. This adapter is intentionally
// inactive until contract, territorial rights, and provider API credentials are verified.
// Never proxy copyrighted tracks or invent playback URLs.
router.get("/music/clips/status", (_req, res) => {
  res.json({
    provider: "feed_fm_clips",
    integration: "prepared",
    enabled: false,
    contractVerified: false,
    argentinaRightsVerified: false,
    catalogAccess: false,
    playableClips: false,
    chargeableRequestsEnabled: false,
    supportedDurationsSeconds: [15, 30],
    note: "Awaiting licensing, territorial approval and official API integration.",
  });
});
router.get("/music/clips/search", (_req, res) => {
  res.status(503).json({
    error: "LICENSED_CLIPS_NOT_AVAILABLE",
    provider: "feed_fm_clips",
    charged: false,
    items: [],
  });
});

// Mureka V8 through fal.ai. Server-side adapter: credentials never leave Render.
// Paid generation remains disabled until an atomic credit ledger and durable
// private storage are connected. Preview performs no provider request.
const musicGenerationRequest = musicDraft.extend({
  durationSeconds: z.number().int().min(3).max(300).default(120),
}).strict();
function composeMurekaRequest(draft: z.infer<typeof musicGenerationRequest>) {
  const style = [draft.description, draft.genre && `Genre: ${draft.genre}`,
    draft.mood && `Mood: ${draft.mood}`,
    draft.instruments.length && `Instruments: ${draft.instruments.join(", ")}`,
    draft.vocalMode === "instrumental" ? "Instrumental music, no vocals." : `Singing in ${draft.language}.`,
  ].filter(Boolean).join("\\n");
  // Mureka's song endpoint accepts either lyrics or a prompt. Unlike Eleven
  // Music, it does not expose a requested-duration parameter.
  return draft.vocalMode === "singing" && draft.lyrics.trim()
    ? { lyrics: draft.lyrics.slice(0, 5000), prompt: style.slice(0, 1024) }
    : { prompt: style.slice(0, 2000) };
}
router.post("/music/generate/preview", (req, res) => {
  const parsed = musicGenerationRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_MUSIC_DRAFT", details: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({
    provider: "fal_ai_mureka_v8", model: "mureka/v8/generate/song",
    status: "dry_run", activated: false, charged: false,
    credentialsConfigured: Boolean(process.env.FAL_KEY?.trim()),
    request: composeMurekaRequest(parsed.data),
    endpoint: "mureka/v8/generate/song",
    durationIsEstimate: true,
    note: "Preview only. No fal.ai API call or credit debit was made.",
  });
});
router.post("/music/generate", (_req, res) => {
  res.status(503).json({ error: "ECHO_MUSIC_NOT_ACTIVATED", provider: "fal_ai_mureka_v8",
    charged: false, retryable: false, missing: ["verified_entitlement", "atomic_credits", "private_audio_storage"] });
});

export default router;
