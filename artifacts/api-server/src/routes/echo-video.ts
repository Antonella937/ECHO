import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ECHO_VIDEO_POLICY } from "../lib/entitlements";
import { videoStorageConfig, VIDEO_PRIVATE_STORAGE_LIMITS, fetchOwnedPrivateVideoAsset, inspectVideoPrivateBucket } from "../lib/videoPrivateStorage";

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

router.get("/video/readiness", async (_req, res) => {
  const [storage, database] = await Promise.all([
    inspectVideoPrivateBucket(),
    pool.query<{video_jobs:string|null;gif_jobs:string|null;ledger:string|null}>(
      `SELECT to_regclass('public.echo_video_generation_jobs')::text AS video_jobs,
              to_regclass('public.echo_video_gif_jobs')::text AS gif_jobs,
              to_regclass('public.echo_video_credit_ledger')::text AS ledger`
    ).then(result=>Boolean(result.rows[0]?.video_jobs && result.rows[0]?.gif_jobs && result.rows[0]?.ledger))
     .catch(()=>false),
  ]);
  res.json({
    status:"preparation_only",
    privateStorageConfigured:storage.configured,
    bucketVerified:storage.verified,
    bucketPrivate:storage.privateBucket,
    databaseMigrationVerified:database,
    generationEnabled:false,checkoutEnabled:false,gifConversionEnabled:false,
    providerConfigured:false,
    acceptedMimeTypes:VIDEO_PRIVATE_STORAGE_LIMITS.acceptedMimeTypes,
    maxVideoBytes:VIDEO_PRIVATE_STORAGE_LIMITS.maxVideoBytes,
    maxGifBytes:VIDEO_PRIVATE_STORAGE_LIMITS.maxGifBytes,
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

/** Read-only GIF history, isolated by authenticated owner. */
router.get("/video/gifs", async (req,res) => {
  try {
    const result = await pool.query<{
      id:string; source_video_job_id:string; status:string; duration_seconds:string;
      width:number; fps:number; result_asset_key:string|null; created_at:Date;
    }>(`SELECT id::text,source_video_job_id::text,status,duration_seconds,width,fps,
              result_asset_key,created_at FROM echo_video_gif_jobs
              WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 50`,[req.userId!]);
    res.json({items:result.rows.map(row=>({
      id:row.id,sourceVideoJobId:row.source_video_job_id,status:row.status,
      durationSeconds:Number(row.duration_seconds),width:row.width,fps:row.fps,
      hasPrivateAsset:Boolean(row.result_asset_key),createdAt:row.created_at,
    })),conversionEnabled:false});
  } catch (error) {
    req.log.warn({err:error},"GIF library unavailable");
    res.json({items:[],conversionEnabled:false,setupRequired:true});
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

/** Download completed GIFs from private storage, never exposing storage credentials. */
router.get("/video/gifs/:gifId/asset", async (req,res) => {
  const id=z.string().uuid().safeParse(req.params.gifId);
  if(!id.success){res.status(400).json({error:"GIF_JOB_ID_INVALID"});return;}
  try{
    const result=await pool.query<{status:string;result_asset_key:string|null}>(
      `SELECT status,result_asset_key FROM echo_video_gif_jobs
       WHERE id=$1::uuid AND owner_id=$2 LIMIT 1`,[id.data,req.userId!]);
    const gif=result.rows[0];
    if(!gif){res.status(404).json({error:"GIF_NOT_FOUND"});return;}
    if(gif.status!=="succeeded" || !gif.result_asset_key){
      res.status(409).json({error:"GIF_NOT_READY"});return;
    }
    if(!gif.result_asset_key.endsWith("/result.gif")){
      res.status(503).json({error:"GIF_ASSET_INVALID"});return;
    }
    const upstream=await fetchOwnedPrivateVideoAsset(gif.result_asset_key,req.userId!,id.data);
    if(upstream.headers.get("content-type")?.split(";")[0].toLowerCase()!=="image/gif"){
      res.status(502).json({error:"GIF_MIME_INVALID"});return;
    }
    res.setHeader("Content-Type","image/gif");
    res.setHeader("Cache-Control","private, no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    res.setHeader("Content-Disposition",`attachment; filename="echo-gif-${id.data}.gif"`);
    const length=Number(upstream.headers.get("content-length"));
    if(Number.isFinite(length)&&length>0&&length<=VIDEO_PRIVATE_STORAGE_LIMITS.maxGifBytes)
      res.setHeader("Content-Length",String(length));
    if(!upstream.body){res.status(502).end();return;}
    const {Readable}=await import("node:stream");
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
  }catch(error){
    req.log.warn({err:error},"Private GIF asset unavailable");
    if(!res.headersSent)res.status(503).json({error:"GIF_PRIVATE_ASSET_UNAVAILABLE"});
    else res.end();
  }
});

/** Stream a completed private asset only after a server-side owner check. */
router.get("/video/library/:jobId/asset", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.jobId);
  if (!id.success) {res.status(400).json({error:"VIDEO_JOB_ID_INVALID"});return;}
  try {
    const result = await pool.query<{status:string;result_asset_key:string|null}>(
      `SELECT status,result_asset_key FROM echo_video_generation_jobs
       WHERE id=$1::uuid AND owner_id=$2 LIMIT 1`, [id.data,req.userId!]);
    const job = result.rows[0];
    if (!job) {res.status(404).json({error:"VIDEO_NOT_FOUND"});return;}
    if (job.status !== "succeeded" || !job.result_asset_key) {
      res.status(409).json({error:"VIDEO_NOT_READY"});return;
    }
    const upstream = await fetchOwnedPrivateVideoAsset(job.result_asset_key,req.userId!,id.data,
      typeof req.headers.range === "string" ? req.headers.range : undefined);
    res.status(upstream.status);
    for (const header of ["content-type","content-length","content-range","accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header,value);
    }
    res.setHeader("Cache-Control","private, no-store");
    res.setHeader("X-Content-Type-Options","nosniff");
    if (!upstream.body) {res.status(502).end();return;}
    const { Readable } = await import("node:stream");
    Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream).pipe(res);
  } catch (error) {
    req.log.warn({err:error},"Private video asset unavailable");
    if (!res.headersSent) res.status(503).json({error:"VIDEO_PRIVATE_ASSET_UNAVAILABLE"});
    else res.end();
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
