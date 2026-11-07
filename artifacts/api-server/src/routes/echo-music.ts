import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";

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

router.get("/music/status", (_req, res) => {
  res.json({
    addon: "echo_music",
    addonRequired: true,
    activated: false,
    generationEnabled: false,
    provider: "not_activated",
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

router.post("/music/generate", (_req, res) => {
  res.status(503).json({ error: "ECHO_MUSIC_NOT_ACTIVATED", charged: false });
});

export default router;
