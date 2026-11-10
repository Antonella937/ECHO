import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ECHO_VIDEO_POLICY } from "../lib/entitlements";
import { videoStorageConfig, VIDEO_PRIVATE_STORAGE_LIMITS } from "../lib/videoPrivateStorage";

/** Video/GIF staging only. No provider requests, payment or balance mutations. */
const router: IRouter = Router();
router.use("/video", requireAuth, (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

const draftSchema = z.object({
  prompt: z.string().trim().min(3).max(2000),
  mode: z.enum(["standard", "advanced_silent", "advanced_audio"]),
  durationSeconds: z.union([z.literal(5), z.literal(10)]),
  aspectRatio: z.enum(["9:16", "16:9", "1:1"]).default("9:16"),
  referenceImageId: z.string().min(1).max(128).optional(),
}).strict();

router.get("/video/catalog", (_req, res) => {
  res.json({
    status: "preparation_only",
    generationEnabled: false,
    checkoutEnabled: false,
    providerConfigured: false,
    currency: ECHO_VIDEO_POLICY.currency,
    creditExpiry: ECHO_VIDEO_POLICY.creditExpiry,
    packs: ECHO_VIDEO_POLICY.packs,
    costs: ECHO_VIDEO_POLICY.generation.costs,
    maxDurationSeconds: ECHO_VIDEO_POLICY.generation.maxDurationSeconds,
    maxConcurrentPerOwner: ECHO_VIDEO_POLICY.generation.maxConcurrentPerOwner,
  });
});

router.get("/video/readiness", (_req, res) => {
  const configured = videoStorageConfig() !== null;
  res.json({
    status: "preparation_only",
    privateStorageConfigured: configured,
    bucketVerified: false,
    databaseMigrationVerified: false,
    generationEnabled: false,
    checkoutEnabled: false,
    gifConversionEnabled: false,
    providerConfigured: false,
    acceptedMimeTypes: VIDEO_PRIVATE_STORAGE_LIMITS.acceptedMimeTypes,
    maxVideoBytes: VIDEO_PRIVATE_STORAGE_LIMITS.maxVideoBytes,
    maxGifBytes: VIDEO_PRIVATE_STORAGE_LIMITS.maxGifBytes,
  });
});

router.post("/video/preflight", (req, res) => {
  const parsed = draftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({ error: "VIDEO_DRAFT_INVALID" });
    return;
  }
  const { mode, durationSeconds, aspectRatio } = parsed.data;
  const key = mode === "standard"
    ? durationSeconds === 5 ? "standard5s" : "standard10s"
    : mode === "advanced_silent"
      ? durationSeconds === 5 ? "advancedSilent5s" : "advancedSilent10s"
      : durationSeconds === 5 ? "advancedAudio5s" : "advancedAudio10s";
  res.json({
    status: "ready_for_provider_configuration",
    mode, durationSeconds, aspectRatio,
    estimatedCredits: ECHO_VIDEO_POLICY.generation.costs[key],
    canSubmit: false,
    requiresProviderActivation: true,
    requiresVerifiedPaymentOrExistingBalance: true,
    charged: false,
    providerCallsMade: 0,
  });
});

/** Read-only owner-scoped generation history; never expose another owner's assets. */
router.get("/video/library", async (req, res) => {
  try {
    const result = await pool.query<{
      id: string; status: string; mode: string; duration_seconds: number;
      credits: number; created_at: Date; result_asset_key: string | null;
    }>(`SELECT id::text, status, mode, duration_seconds, credits, created_at, result_asset_key
        FROM echo_video_generation_jobs WHERE owner_id=$1
        ORDER BY created_at DESC LIMIT 50`, [req.userId!]);
    res.json({ items: result.rows.map(row => ({
      id: row.id, status: row.status, mode: row.mode,
      durationSeconds: row.duration_seconds, estimatedCredits: row.credits,
      createdAt: row.created_at, hasPrivateAsset: Boolean(row.result_asset_key),
    })), storagePrivate: true, generationEnabled: false });
  } catch (error) {
    req.log.warn({ err: error }, "Video library not initialized");
    res.json({ items: [], storagePrivate: true, generationEnabled: false,
      setupRequired: true });
  }
});

const gifDraftSchema = z.object({
  videoJobId: z.string().uuid(),
  startSeconds: z.number().finite().min(0).max(10).default(0),
  durationSeconds: z.number().finite().min(1).max(10),
  width: z.union([z.literal(320), z.literal(480), z.literal(640)]).default(480),
  fps: z.union([z.literal(10), z.literal(12), z.literal(15)]).default(12),
}).strict();

/** GIF preparation is a read-only ownership check. It never converts or debits. */
router.post("/video/gif/preflight", async (req, res) => {
  const parsed = gifDraftSchema.safeParse(req.body);
  if (!parsed.success) {
    res.status(400).json({error:"GIF_DRAFT_INVALID"}); return;
  }
  const draft = parsed.data;
  try {
    const result = await pool.query<{status:string;duration_seconds:number;result_asset_key:string|null}>(
      `SELECT status,duration_seconds,result_asset_key FROM echo_video_generation_jobs
       WHERE owner_id=$1 AND id=$2::uuid LIMIT 1`, [req.userId!,draft.videoJobId]);
    const source = result.rows[0];
    if (!source) {res.status(404).json({error:"VIDEO_NOT_FOUND"});return;}
    if (source.status !== "succeeded" || !source.result_asset_key) {
      res.status(409).json({error:"VIDEO_NOT_READY"});return;
    }
    if (draft.startSeconds + draft.durationSeconds > source.duration_seconds) {
      res.status(400).json({error:"GIF_TIME_RANGE_INVALID"});return;
    }
    res.json({status:"ready_for_converter_configuration", sourceJobId:draft.videoJobId,
      startSeconds:draft.startSeconds,durationSeconds:draft.durationSeconds,
      width:draft.width,fps:draft.fps,estimatedCredits:0,canConvert:false,
      charged:false,providerCallsMade:0});
  } catch (error) {
    req.log.warn({err:error},"GIF preparation unavailable");
    res.status(503).json({error:"GIF_PREPARATION_UNAVAILABLE"});
  }
});

/** GIF conversion is intentionally unavailable until a safe private media pipeline exists. */
router.post("/video/convert-gif", (_req, res) => {
  res.status(503).json({ error: "VIDEO_GIF_CONVERSION_NOT_ENABLED",
    charged: false, providerCallsMade: 0 });
});

router.post("/video/generate", (_req, res) => {
  res.status(503).json({
    error: "VIDEO_GENERATION_NOT_ENABLED",
    charged: false,
    providerCallsMade: 0,
  });
});

export default router;
