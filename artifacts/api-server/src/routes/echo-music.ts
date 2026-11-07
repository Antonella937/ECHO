import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { db, echoMediaTable, echoMusicLibraryTable } from "@workspace/db";
import { and, desc, eq } from "drizzle-orm";

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

router.get("/music/status", (_req, res) => {
  res.json({
    addon: "echo_music",
    addonRequired: true,
    activated: false,
    generationEnabled: false,
    provider: "elevenlabs_music",
    model: "music_v2_5",
    providerConfigured: Boolean(process.env.ELEVENLABS_API_KEY?.trim()),
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

// Official Eleven Music API: POST https://api.elevenlabs.io/v1/music
// Keep all billable calls disabled until subscription, usage limits, storage,
// and explicit activation are reviewed. Voice API credentials are server-only.
const musicGenerationRequest = musicDraft.extend({
  durationSeconds: z.number().int().min(3).max(300).default(120),
}).strict();
function composeElevenMusicRequest(draft: z.infer<typeof musicGenerationRequest>) {
  const prompt = [
    draft.description,
    draft.genre && `Genre: ${draft.genre}`,
    draft.mood && `Mood: ${draft.mood}`,
    draft.instruments.length && `Instruments: ${draft.instruments.join(", ")}`,
    draft.vocalMode === "instrumental"
      ? "Instrumental only, no singing or spoken words."
      : `Sung vocals in language ${draft.language}.`,
    draft.vocalMode === "singing" && draft.lyrics && `Use these original lyrics:\n${draft.lyrics}`,
  ].filter(Boolean).join("\n");
  return {
    model_id: "music_v2_5" as const,
    prompt: prompt.slice(0, 4100),
    music_length_ms: draft.durationSeconds * 1000,
    force_instrumental: draft.vocalMode === "instrumental",
  };
}
router.post("/music/generate/preview", (req, res) => {
  const parsed = musicGenerationRequest.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_MUSIC_DRAFT", details: parsed.error.flatten().fieldErrors });
    return;
  }
  res.json({
    provider: "elevenlabs_music",
    status: "dry_run",
    activated: false,
    charged: false,
    request: composeElevenMusicRequest(parsed.data),
    endpoint: "POST /v1/music",
    note: "Request preview only. No ElevenLabs API call was made.",
  });
});

router.post("/music/generate", (_req, res) => {
  res.status(503).json({ error: "ECHO_MUSIC_NOT_ACTIVATED", provider: "elevenlabs_music", charged: false, retryable: false });
});

export default router;
