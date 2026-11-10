import { randomUUID } from "node:crypto";
import { Router, raw, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { db, echoMediaTable, echoMusicLibraryTable } from "@workspace/db";
import { and, desc, eq, isNotNull, sql } from "drizzle-orm";
import { ObjectStorageService } from "../lib/objectStorage";
import { pipeMedia } from "../lib/pipeMedia";
import { fetchPrivateGeneratedMusic } from "../lib/musicPrivateStorage";
import { storePrivateVocalSample, fetchOwnedPrivateVocalSample } from "../lib/musicVoiceSampleStorage";
import { submitConfirmedVoiceClone, syncVoiceCloneJob } from "../lib/musicVoiceCloneOrchestrator";
import { submitConfirmedVocalSeparation, syncVocalSeparation } from "../lib/musicVocalSeparationOrchestrator";
import { reserveMusicJob, submitReservedMusicJob, pollMusicJob, resolveCharacterSingingVoice } from "../lib/musicJobOrchestrator";
import { MUREKA_SONG_MODEL, MUREKA_INSTRUMENTAL_MODEL } from "../lib/murekaMusic";

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

const singingVoiceRegistration = z.object({
  characterId: z.string().min(1).max(128),
  vocalId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  consentConfirmed: z.literal(true),
  replaceExisting: z.boolean().default(false),
}).strict();
const router: IRouter = Router();
router.use("/music", requireAuth, (_req, res, next) => {
  res.setHeader("Cache-Control", "private, no-store");
  next();
});

// Subscription is enforced server-side for private studio voice mutations.
// A hidden UI is not an authorization boundary. Existing founder grants work
// through the same active entitlement check; no public checkout is enabled.
async function requireMusicStudioEntitlement(req: Parameters<typeof requireAuth>[0], res: Parameters<typeof requireAuth>[1], next: Parameters<typeof requireAuth>[2]) {
  try {
    const rows = await db.execute(sql`SELECT status, current_period_end AS "periodEnd"
      FROM echo_music_entitlements WHERE owner_id=${req.userId!} LIMIT 1`);
    const entry = rows.rows[0] as {status?:string;periodEnd?:Date|string|null}|undefined;
    const active = !!entry && ['active','trialing'].includes(entry.status || '')
      && (!entry.periodEnd || new Date(entry.periodEnd).getTime() > Date.now());
    if (!active) {res.status(403).json({error:"ECHO_MUSIC_SUBSCRIPTION_REQUIRED",checkoutAvailable:false});return;}
    next();
  } catch {res.status(503).json({error:"MUSIC_ENTITLEMENT_UNAVAILABLE"});}
}
router.use("/music/voices", requireMusicStudioEntitlement);

// Private staging only: raw audio avoids the global 2 MB JSON body limit.
// This does not call fal.ai, clone a voice, or incur provider charges.
router.post("/music/voices/clone/sample", raw({type:["audio/mpeg","audio/mp3","audio/mp4","audio/x-m4a","audio/wav","audio/x-wav"],limit:"10mb"}), async (req,res) => {
  const characterId = z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/).safeParse(req.query.characterId);
  const duration = z.coerce.number().finite().min(15).max(30).safeParse(req.query.durationSeconds);
  if (!characterId.success || !duration.success || req.headers["x-voice-consent"] !== "confirmed") {
    res.status(400).json({error:"VOICE_SAMPLE_CONSENT_OR_DURATION_REQUIRED"});return;
  }
  if (!Buffer.isBuffer(req.body)) {res.status(415).json({error:"VOICE_SAMPLE_BINARY_REQUIRED"});return;}
  try {
    const mime = String(req.headers["content-type"]||"").split(";")[0].toLowerCase();
    const result = await storePrivateVocalSample(req.userId!,characterId.data,req.body,mime);
    res.status(201).json({status:"stored_private",characterId:characterId.data,
      durationSeconds:duration.data,...result,providerCallsMade:0,charged:false});
  } catch (error) {
    req.log.warn({err:error},"Voice sample staging failed");
    res.status(400).json({error:"VOICE_SAMPLE_UPLOAD_FAILED"});
  }
});

// Preflight a privately staged sample before any billable clone is allowed.
// The server reads it back, checks owner/character, and validates the bytes.
// It never sends the sample to fal.ai or reserves a paid request.
const voiceSamplePreflight = z.object({
  characterId:z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  storageKey:z.string().min(1).max(512),
  durationSeconds:z.number().finite().min(15).max(30),
  consentConfirmed:z.literal(true),
}).strict();
router.post("/music/voices/clone/sample/preflight", async (req,res) => {
  const parsed=voiceSamplePreflight.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error:"VOICE_SAMPLE_PREFLIGHT_INVALID"});return;}
  try {
    const sample=await fetchOwnedPrivateVocalSample(req.userId!,parsed.data.characterId,parsed.data.storageKey);
    res.json({status:"ready_for_confirmation",characterId:parsed.data.characterId,
      storageKey:parsed.data.storageKey,bytes:sample.bytes.length,mimeType:sample.mimeType,
      durationSeconds:parsed.data.durationSeconds,estimatedCloneCostUsd:5,
      requiresExplicitChargeConfirmation:true,charged:false,providerCallsMade:0});
  } catch(error) {
    req.log.warn({err:error},"Voice sample preflight failed");
    res.status(400).json({error:"VOICE_SAMPLE_PREFLIGHT_FAILED"});
  }
});

// Durable preparation, without charging. Requires the Neon clone-jobs migration.
// Only a later explicitly confirmed transition may submit to the provider.
router.post("/music/voices/clone/jobs", async(req,res) => {
  const parsed=voiceSamplePreflight.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error:"VOICE_CLONE_JOB_INVALID"});return;}
  try {
    await fetchOwnedPrivateVocalSample(req.userId!,parsed.data.characterId,parsed.data.storageKey);
    const id=randomUUID();
    const result=await db.execute(sql`
      INSERT INTO echo_music_voice_clone_jobs
        (id,owner_id,character_id,sample_storage_key,sample_duration_seconds,consent_confirmed)
      VALUES (${id}::uuid,${req.userId!},${parsed.data.characterId},
        ${parsed.data.storageKey},${parsed.data.durationSeconds},true)
      ON CONFLICT (owner_id,character_id)
        WHERE status IN ('awaiting_confirmation','submitting','processing','submission_uncertain')
      DO NOTHING RETURNING id
    `);
    if (!result.rows.length) {res.status(409).json({error:"VOICE_CLONE_JOB_ALREADY_ACTIVE"});return;}
    res.status(201).json({jobId:id,status:"awaiting_confirmation",estimatedCostUsd:5,
      charged:false,providerCallsMade:0});
  } catch(error) {
    req.log.warn({err:error},"Voice clone job preparation failed");
    res.status(503).json({error:"VOICE_CLONE_JOB_PREPARATION_UNAVAILABLE"});
  }
});
router.get("/music/voices/clone/jobs/:id", async(req,res) => {
  const id=z.string().uuid().safeParse(req.params.id);
  if (!id.success) {res.status(400).json({error:"VOICE_CLONE_JOB_ID_INVALID"});return;}
  try {
    const result=await db.execute(sql`
      SELECT id,character_id,status,estimated_cost_usd,provider_vocal_id,error_code,created_at,completed_at
      FROM echo_music_voice_clone_jobs WHERE id=${id.data}::uuid AND owner_id=${req.userId!} LIMIT 1
    `);
    if (!result.rows.length) {res.status(404).json({error:"VOICE_CLONE_JOB_NOT_FOUND"});return;}
    res.setHeader("Cache-Control","no-store");
    res.json({job:result.rows[0]});
  } catch(error) {req.log.warn({err:error},"Voice clone job lookup failed");
    res.status(503).json({error:"VOICE_CLONE_JOB_LOOKUP_UNAVAILABLE"});}
});

// Explicit paid confirmation. Disabled by default until billing controls and
// the provider integration are verified. No automatic retries.
const cloneConfirm=z.object({chargeConfirmed:z.literal(true),consentConfirmed:z.literal(true)}).strict();
router.post("/music/voices/clone/jobs/:id/confirm", async(req,res) => {
  const id=z.string().uuid().safeParse(req.params.id);
  if(!id.success || !cloneConfirm.safeParse(req.body).success) {
    res.status(400).json({error:"VOICE_CLONE_EXPLICIT_CONFIRMATION_REQUIRED"});return;
  }
  if(process.env.ECHO_MUSIC_VOICE_CLONE_ENABLED!=="true") {
    res.status(503).json({error:"VOICE_CLONE_SPENDING_DISABLED",charged:false});return;
  }
  try {
    const result=await submitConfirmedVoiceClone(req.userId!,id.data);
    res.json(result);
  } catch(error) {
    req.log.error({err:error},"Voice clone submission failed");
    res.status(503).json({error:"VOICE_CLONE_SUBMISSION_REQUIRES_REVIEW"});
  }
});
router.post("/music/voices/clone/jobs/:id/sync", async(req,res) => {
  const id=z.string().uuid().safeParse(req.params.id);
  if(!id.success){res.status(400).json({error:"VOICE_CLONE_JOB_ID_INVALID"});return;}
  try {res.json(await syncVoiceCloneJob(req.userId!,id.data));}
  catch(error){req.log.error({err:error},"Voice clone sync failed");
    res.status(503).json({error:"VOICE_CLONE_SYNC_UNAVAILABLE"});}
});

// Prepare a vocal-isolation job. This is separate from the $5 voice clone.
// The source must be the user's own previously staged private audio.
router.post("/music/voices/separation/jobs",async(req,res)=>{
 const parsed=voiceSamplePreflight.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"VOCAL_SEPARATION_INPUT_INVALID"});return;}
 try{
   const sample=await fetchOwnedPrivateVocalSample(req.userId!,parsed.data.characterId,parsed.data.storageKey);
   const id=randomUUID();
   const result=await db.execute(sql`
     INSERT INTO echo_music_vocal_separation_jobs(id,owner_id,character_id,sample_storage_key,duration_seconds)
     VALUES(${id}::uuid,${req.userId!},${parsed.data.characterId},${parsed.data.storageKey},${parsed.data.durationSeconds})
     ON CONFLICT(owner_id,character_id)
       WHERE status IN ('awaiting_confirmation','submitting','processing','submission_uncertain')
     DO NOTHING RETURNING id
   `);
   if(!result.rows.length){res.status(409).json({error:"VOCAL_SEPARATION_ALREADY_ACTIVE"});return;}
   res.status(201).json({jobId:id,status:"awaiting_confirmation",sourceBytes:sample.bytes.length,
     model:"fal-ai/demucs",requiresPaidConfirmation:true,charged:false});
 }catch(error){req.log.warn({err:error},"Vocal separation preparation failed");
   res.status(503).json({error:"VOCAL_SEPARATION_PREPARATION_FAILED"});}
});
router.get("/music/voices/separation/jobs/:id",async(req,res)=>{
 const id=z.string().uuid().safeParse(req.params.id);
 if(!id.success){res.status(400).json({error:"VOCAL_SEPARATION_JOB_ID_INVALID"});return;}
 try{
   const result=await db.execute(sql`
     SELECT id,character_id,status,isolated_storage_key,created_at,completed_at
     FROM echo_music_vocal_separation_jobs
     WHERE id=${id.data}::uuid AND owner_id=${req.userId!} LIMIT 1
   `);
   if(!result.rows.length){res.status(404).json({error:"VOCAL_SEPARATION_JOB_NOT_FOUND"});return;}
   res.setHeader("Cache-Control","no-store");res.json({job:result.rows[0]});
 }catch(error){req.log.warn({err:error},"Vocal separation status failed");
   res.status(503).json({error:"VOCAL_SEPARATION_STATUS_UNAVAILABLE"});}
});

// Separate consent for paid stem isolation; no charge when feature is disabled.
router.post("/music/voices/separation/jobs/:id/confirm",async(req,res)=>{
 const id=z.string().uuid().safeParse(req.params.id);
 const consent=z.object({chargeConfirmed:z.literal(true),consentConfirmed:z.literal(true)}).strict().safeParse(req.body);
 if(!id.success || !consent.success){res.status(400).json({error:"VOCAL_SEPARATION_EXPLICIT_CONFIRMATION_REQUIRED"});return;}
 if(process.env.ECHO_MUSIC_VOCAL_SEPARATION_ENABLED!=="true"){
   res.status(503).json({error:"VOCAL_SEPARATION_SPENDING_DISABLED",charged:false});return;
 }
 try{res.json(await submitConfirmedVocalSeparation(req.userId!,id.data));}
 catch(error){req.log.error({err:error},"Vocal separation submission failed");
   res.status(503).json({error:"VOCAL_SEPARATION_SUBMISSION_REQUIRES_REVIEW"});}
});
router.post("/music/voices/separation/jobs/:id/sync",async(req,res)=>{
 const id=z.string().uuid().safeParse(req.params.id);
 if(!id.success){res.status(400).json({error:"VOCAL_SEPARATION_JOB_ID_INVALID"});return;}
 try{res.json(await syncVocalSeparation(req.userId!,id.data));}
 catch(error){req.log.error({err:error},"Vocal separation sync failed");
   res.status(503).json({error:"VOCAL_SEPARATION_SYNC_UNAVAILABLE"});}
});

// Non-billable voice cloning quote. No audio or provider credentials leave ECHO.
// The actual $5 provider submission must be separately authorized and reserved.
const voiceCloneQuoteSchema = z.object({
  characterId: z.string().min(1).max(128).regex(/^[a-zA-Z0-9_-]+$/),
  source: z.enum(["upload", "library"]),
  durationSeconds: z.number().finite().min(15).max(30),
  fileSizeBytes: z.number().int().positive().max(10 * 1024 * 1024 - 1).optional(),
  fileName: z.string().max(255).optional(),
  libraryTrackId: z.string().uuid().optional(),
  consentConfirmed: z.literal(true),
}).strict().superRefine((data, ctx) => {
  if (data.source === "upload" && (!data.fileName || !/\.(mp3|m4a)$/i.test(data.fileName) || !data.fileSizeBytes))
    ctx.addIssue({code:z.ZodIssueCode.custom,message:"INVALID_VOICE_SAMPLE"});
  if (data.source === "library" && !data.libraryTrackId)
    ctx.addIssue({code:z.ZodIssueCode.custom,message:"MUSIC_TRACK_REQUIRED"});
});
router.post("/music/voices/clone/quote", async (req,res) => {
  const parsed = voiceCloneQuoteSchema.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error:"INVALID_VOICE_CLONE_REFERENCE"});return;}
  try {
    if (parsed.data.source === "library") {
      const found = await db.select({
        id:echoMusicLibraryTable.id,
        audioPath:echoMusicLibraryTable.audioPath,
        durationSeconds:echoMusicLibraryTable.durationSeconds,
      })
        .from(echoMusicLibraryTable)
        .where(and(eq(echoMusicLibraryTable.ownerId,req.userId!),
          eq(echoMusicLibraryTable.id,parsed.data.libraryTrackId!),
          eq(echoMusicLibraryTable.characterId,parsed.data.characterId),
          eq(echoMusicLibraryTable.status,"saved_audio")))
        .limit(1);
      const track = found[0];
      if (!track || !track.audioPath?.startsWith("generated/")) {
        res.status(404).json({error:"GENERATED_MUSIC_TRACK_NOT_FOUND"});return;
      }
      if (track.durationSeconds < parsed.data.durationSeconds) {
        res.status(400).json({error:"VOICE_SAMPLE_EXCEEDS_TRACK_DURATION"});return;
      }
      const generated = await db.execute(sql`SELECT id FROM echo_music_generation_jobs
        WHERE owner_id=${req.userId!} AND audio_path=${track.audioPath}
          AND status='completed' LIMIT 1`);
      if (!generated.rows.length) {
        res.status(403).json({error:"VOICE_SAMPLE_SOURCE_NOT_VERIFIED"});return;
      }
    }
    res.json({status:"preview_only",source:parsed.data.source,characterId:parsed.data.characterId,
      provider:"fal_ai_mureka_voice_clone",model:"mureka/api/voice/clone",
      estimatedCostUsd:5,paidCallsMade:0,charged:false,cloneCreated:false,
      requiresExplicitPaymentConfirmation:true,
      requiresVocalOnlyAudio:true,
      note:"No audio uploaded, vocal extraction performed, or clone submitted."});
  } catch {res.status(503).json({error:"VOICE_CLONE_QUOTE_UNAVAILABLE"});}
});

// Registration only links an already-created Mureka vocal identity; no paid calls.
router.get("/music/voices/:characterId", async (req,res) => {
  const characterId = z.string().min(1).max(128).safeParse(req.params.characterId);
  if (!characterId.success) { res.status(400).json({error:"INVALID_CHARACTER_ID"}); return; }
  try {
    const rows = await db.execute(sql`SELECT mureka_vocal_id FROM echo_character_singing_voices WHERE owner_id=${req.userId!} AND character_id=${characterId.data} LIMIT 1`);
    const speech = await db.execute(sql`
      SELECT s.provider, s.status FROM echo_voice_projects p
      JOIN echo_voice_samples s ON s.id=p.selected_sample_id AND s.owner_id=p.owner_id
      WHERE p.owner_id=${req.userId!} AND p.character_id=${characterId.data}
        AND s.status='ready'
      ORDER BY p.updated_at DESC LIMIT 1
    `);
    const speechReady = speech.rows.length > 0;
    const singingReady = rows.rows.length > 0;
    res.json({
      configured: singingReady, vocalId: rows.rows[0]?.mureka_vocal_id ?? null,
      speechReady, singingReady,
      consistencyStatus: speechReady && singingReady ? 'both_configured_unverified' :
        speechReady ? 'speech_only' : singingReady ? 'singing_only' : 'unconfigured',
      sameTimbreVerified: false
    });
  } catch { res.status(503).json({error:"VOICE_LOOKUP_UNAVAILABLE"}); }
});
router.post("/music/voices", async (req,res) => {
  const parsed = singingVoiceRegistration.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:"INVALID_VOCAL_ID_OR_CONSENT"}); return; }
  try {
    // Do not silently replace a character's established singing identity.
    // Explicit replacement is a separate user decision, not a side effect
    // of selecting a new voice or importing a previously generated ID.
    const saved = await db.execute(sql`SELECT mureka_vocal_id FROM echo_character_singing_voices
      WHERE owner_id=${req.userId!} AND character_id=${parsed.data.characterId} LIMIT 1`);
    const current = saved.rows[0]?.mureka_vocal_id;
    if (typeof current === "string" && current !== parsed.data.vocalId && !parsed.data.replaceExisting) {
      res.status(409).json({error:"CHARACTER_SINGING_VOICE_ALREADY_CONFIGURED",
        requiresExplicitReplacement:true,characterId:parsed.data.characterId});return;
    }
    const linked = await db.execute(sql`INSERT INTO echo_character_singing_voices (owner_id,character_id,mureka_vocal_id)
      VALUES (${req.userId!},${parsed.data.characterId},${parsed.data.vocalId})
      ON CONFLICT (owner_id,character_id) DO UPDATE SET
        mureka_vocal_id=EXCLUDED.mureka_vocal_id,updated_at=now()
      WHERE echo_character_singing_voices.mureka_vocal_id=EXCLUDED.mureka_vocal_id
        OR ${parsed.data.replaceExisting}
      RETURNING mureka_vocal_id`);
    if (!linked.rows.length) {
      res.status(409).json({error:"CHARACTER_SINGING_VOICE_ALREADY_CONFIGURED",
        requiresExplicitReplacement:true,characterId:parsed.data.characterId});return;
    }
    res.json({configured:true,characterId:parsed.data.characterId,voiceIdentityLocked:true});
  } catch { res.status(503).json({error:"VOICE_SAVE_UNAVAILABLE"}); }
});
// Removing a link never deletes a provider voice or an existing song.
router.delete("/music/voices/:characterId", async (req,res) => {
  const parsed = z.string().min(1).max(128).safeParse(req.params.characterId);
  if (!parsed.success) { res.status(400).json({error:"INVALID_CHARACTER_ID"}); return; }
  try {
    await db.execute(sql`DELETE FROM echo_character_singing_voices
      WHERE owner_id=${req.userId!} AND character_id=${parsed.data}`);
    res.json({configured:false,characterId:parsed.data});
  } catch { res.status(503).json({error:"VOICE_UNLINK_UNAVAILABLE"}); }
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
// One audio file can be saved to several characters' libraries inside the
// same authenticated ECHO universe/account. No new generation or storage copy.
// This is NOT a cross-account DM delivery or a public sharing grant.
const characterMusicSave = z.object({
  trackId: z.string().uuid(),
  characterId: z.string().min(1).max(128),
}).strict();
router.post("/music/library/save-to-character", async (req, res) => {
  const parsed = characterMusicSave.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_CHARACTER_MUSIC_SAVE" }); return; }
  const { trackId, characterId } = parsed.data;
  try {
    const result = await db.execute(sql`
      INSERT INTO echo_music_character_saves (owner_id,track_id,character_id)
      SELECT l.owner_id,l.id,${characterId}
      FROM echo_music_library l
      WHERE l.owner_id=${req.userId!} AND l.id=${trackId}
        AND l.status='saved_audio' AND l.audio_path IS NOT NULL
        AND (
          l.character_id=${characterId}
          OR (l.published_at IS NOT NULL AND EXISTS (
            SELECT 1 FROM echo_music_shares sh
            WHERE sh.owner_id=l.owner_id AND sh.track_id=l.id
              AND sh.surface='dm' AND sh.target_id=${characterId}
          ))
        )
      ON CONFLICT (owner_id,track_id,character_id) DO NOTHING
      RETURNING track_id
    `);
    if (!result.rows.length) {
      const exists = await db.execute(sql`
        SELECT 1 FROM echo_music_character_saves
        WHERE owner_id=${req.userId!} AND track_id=${trackId} AND character_id=${characterId}
      `);
      if (!exists.rows.length) { res.status(404).json({ error: "MUSIC_NOT_SHARED_WITH_CHARACTER" }); return; }
    }
    res.json({ saved: true, reusedExistingAudio: true, creditsUsed: 0, characterId, trackId });
  } catch (error) {
    req.log.error({ err: error }, "Save music to character failed");
    res.status(503).json({ error: "CHARACTER_MUSIC_SAVE_UNAVAILABLE" });
  }
});
router.get("/music/library/character/:characterId", async (req, res) => {
  const parsed = z.string().min(1).max(128).safeParse(req.params.characterId);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_CHARACTER_ID" }); return; }
  try {
    const result = await db.execute(sql`
      SELECT l.id,l.title,l.prompt,l.duration_seconds AS "durationSeconds",
        l.audio_path AS "audioPath",l.status,l.character_id AS "originalCharacterId",
        s.character_id AS "characterId",s.saved_at AS "savedAt"
      FROM echo_music_character_saves s
      JOIN echo_music_library l ON l.owner_id=s.owner_id AND l.id=s.track_id
      WHERE s.owner_id=${req.userId!} AND s.character_id=${parsed.data}
      ORDER BY s.saved_at DESC LIMIT 100
    `);
    res.json({ items: result.rows });
  } catch (error) {
    req.log.error({ err: error }, "Character music library unavailable");
    res.status(503).json({ error: "CHARACTER_MUSIC_LIBRARY_UNAVAILABLE" });
  }
});
router.post("/music/library", async (req, res) => {
  const parsed = libraryItem.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_MUSIC_LIBRARY_ITEM" }); return; }
  const item = parsed.data;
  // Generated tracks are server-managed. A client must never overwrite a
  // completed generated song or replace its private audio path via upsert.
  const generated = await db.execute(sql`
    SELECT id FROM echo_music_generation_jobs
    WHERE id=${item.id}::uuid AND owner_id=${req.userId!} LIMIT 1
  `);
  if (generated.rows.length) {
    res.status(409).json({ error: "GENERATED_TRACK_SERVER_MANAGED" }); return;
  }
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
    // Generated tracks are backed by immutable paid jobs and private objects.
    // Deleting only the library row would orphan a paid generation and audio.
    // A dedicated transactional deletion flow is required for these tracks.
    const generated = await db.execute(sql`
      SELECT id FROM echo_music_generation_jobs
      WHERE id=${parsed.data}::uuid AND owner_id=${req.userId!}
      LIMIT 1
    `);
    if (generated.rows.length) {
      res.status(409).json({ error: "GENERATED_TRACK_DELETION_NOT_SUPPORTED" }); return;
    }
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
    // Generated music is owned through its completed Neon generation job,
    // whereas user-uploaded music is owned through echoMediaTable.
    const generatedTrack = await db.execute(sql`
      SELECT id FROM echo_music_generation_jobs
      WHERE id=${id.data}::uuid AND owner_id=${req.userId!}
        AND status='completed' AND audio_path=${track.audioPath} LIMIT 1
    `);
    if (!generatedTrack.rows.length) {
      const [owned] = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable).where(and(
        eq(echoMediaTable.objectPath, track.audioPath), eq(echoMediaTable.ownerId, req.userId!))).limit(1);
      if (!owned) { res.status(403).json({ error: "AUDIO_NOT_OWNED" }); return; }
    }
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
// A share reference is not a feed post, story, or DM by itself.
// Surface creation must validate the destination and its permissions before
// attaching this reference. The track remains private until explicitly shared.
const musicShareRequest = z.object({
  trackId: z.string().uuid(),
  surface: z.enum(["feed", "story", "dm"]),
  targetId: z.string().min(1).max(128),
  clipStartSeconds: z.number().int().min(0).default(0),
  clipDurationSeconds: z.number().int().min(1).max(60).nullable().default(null),
}).strict();
// List only the authenticated account's saved share drafts. No publication
// or DM delivery occurs here; the surface-specific API must authorize that.
router.get("/music/share-references", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT s.id, s.track_id AS "trackId", s.surface,
        s.target_id AS "targetId", s.clip_start_seconds AS "clipStartSeconds",
        s.clip_duration_seconds AS "clipDurationSeconds",
        l.title, l.character_id AS "characterId", l.duration_seconds AS "durationSeconds"
      FROM echo_music_shares s
      JOIN echo_music_library l ON l.owner_id=s.owner_id AND l.id=s.track_id
      WHERE s.owner_id=${req.userId!}
      ORDER BY s.created_at DESC LIMIT 100
    `);
    res.json({ references: result.rows });
  } catch (error) {
    req.log.error({ err: error }, "Music share reference listing failed");
    res.status(503).json({ error: "MUSIC_SHARE_REFERENCES_UNAVAILABLE" });
  }
});
router.delete("/music/share-reference/:id", async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_MUSIC_SHARE_ID" }); return; }
  try {
    const result = await db.execute(sql`
      DELETE FROM echo_music_shares WHERE id=${parsed.data}::uuid
        AND owner_id=${req.userId!} RETURNING id
    `);
    res.json({ deleted: result.rows.length > 0, publishedContentDeleted: false });
  } catch (error) {
    req.log.error({ err: error }, "Music share reference deletion failed");
    res.status(503).json({ error: "MUSIC_SHARE_REFERENCE_DELETE_UNAVAILABLE" });
  }
});
router.post("/music/share-reference", async (req, res) => {
  const parsed = musicShareRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_MUSIC_SHARE" }); return; }
  const item = parsed.data;
  try {
    const [track] = await db.select().from(echoMusicLibraryTable).where(and(
      eq(echoMusicLibraryTable.ownerId, req.userId!), eq(echoMusicLibraryTable.id, item.trackId)
    )).limit(1);
    if (!track || track.status !== "saved_audio" || !track.audioPath) {
      res.status(404).json({ error: "SHAREABLE_MUSIC_NOT_FOUND" }); return;
    }
    if (item.clipStartSeconds >= track.durationSeconds ||
      (item.clipDurationSeconds !== null && item.clipStartSeconds + item.clipDurationSeconds > track.durationSeconds)) {
      res.status(400).json({ error: "MUSIC_CLIP_OUT_OF_RANGE" }); return;
    }
    // This is a private owner-scoped draft reference, not permission to send
    // or publish. A later surface endpoint must validate target ownership.
    const result = await db.execute(sql`
      INSERT INTO echo_music_shares
        (owner_id,track_id,surface,target_id,clip_start_seconds,clip_duration_seconds)
      VALUES (${req.userId!},${item.trackId},${item.surface},${item.targetId},
        ${item.clipStartSeconds},${item.clipDurationSeconds})
      ON CONFLICT (owner_id,track_id,surface,target_id)
      DO UPDATE SET clip_start_seconds=EXCLUDED.clip_start_seconds,
        clip_duration_seconds=EXCLUDED.clip_duration_seconds
      RETURNING id,track_id AS "trackId",surface,target_id AS "targetId",
        clip_start_seconds AS "clipStartSeconds",clip_duration_seconds AS "clipDurationSeconds"
    `);
    res.json({ reference: result.rows[0], published: false, sent: false, creditsUsed: 0 });
  } catch (error) {
    req.log.error({ err: error }, "Music share reference failed");
    res.status(503).json({ error: "MUSIC_SHARE_REFERENCE_UNAVAILABLE" });
  }
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
    // Generated audio is held in private Supabase, not legacy /objects storage.
    // Only explicitly published tracks can be streamed through this endpoint.
    if (track.audioPath.startsWith("generated/")) {
      const generated = await db.execute(sql`
        SELECT id FROM echo_music_generation_jobs
        WHERE id=${track.id}::uuid AND owner_id=${track.ownerId}
          AND status='completed' AND audio_path=${track.audioPath} LIMIT 1
      `);
      if (!generated.rows.length) { res.status(404).json({ error: "AUDIO_NOT_FOUND" }); return; }
      const upstream = await fetchPrivateGeneratedMusic(track.audioPath, req.headers.range);
      res.status(upstream.status);
      for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = upstream.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      res.setHeader("Cache-Control", "private, no-store");
      res.setHeader("X-Content-Type-Options", "nosniff");
      if (!upstream.body) { res.end(); return; }
      const { Readable } = await import("node:stream");
      const stream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
      stream.on("error", error => {
        req.log.warn({ err: error }, "Published generated music stream interrupted");
        if (!res.headersSent) res.status(502).end(); else res.destroy(error);
      });
      stream.pipe(res);
      return;
    }
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
// Job reservations live in Neon, never in browser state. Only one active
// generation per account can exist at a time; monthly and purchased credits
// must be atomically reserved before enabling the paid provider adapter.
// Until billing and quota enforcement are implemented, no reservation endpoint
// is exposed and the paid generation route remains locked.
// Read-only, server-authoritative access. Checkout must be confirmed by a
// trusted payment webhook before this table is marked active.
router.get("/music/entitlement", async (req, res) => {
  try {
    const result = await db.execute(sql`
      SELECT status, current_period_end AS "periodEnd"
      FROM echo_music_entitlements WHERE owner_id=${req.userId!} LIMIT 1
    `);
    const record = result.rows[0] as {status?: string;periodEnd?: string | Date | null}|undefined;
    const validPeriod = !record?.periodEnd || new Date(record.periodEnd).getTime() > Date.now();
    const active = Boolean(record && ['active','trialing'].includes(record.status || '') && validPeriod);
    res.json({ active, status: active ? record!.status : 'inactive',
      checkoutAvailable: false, priceUsdMonthly: 9.99,
      message: active ? null : 'Subscription checkout is not active yet.' });
  } catch (error) {
    req.log.error({err:error}, 'Music entitlement lookup failed');
    res.status(503).json({error:'MUSIC_ENTITLEMENT_UNAVAILABLE'});
  }
});
router.get("/music/plan", (_req, res) => {
  res.json({ plan: MUSIC_PLAN, billingEnabled: false, generationEnabled: false,
    autonomousGenerationEnabled: false, purchasesEnabled: false,
    providerValidationPending: true });
});

// Read-only account usage. No free credits are issued by this endpoint:
// monthly allowances become spendable only after entitlement verification.
router.get("/music/usage", async (req, res) => {
  try {
    const month = new Date().toISOString().slice(0, 7);
    const result = await db.execute(sql`
      SELECT mode, source_bucket AS bucket, status, COUNT(*)::integer AS count
      FROM echo_music_generation_jobs
      WHERE owner_id = ${req.userId!} AND period_month = ${month}
        AND status IN ('reserved', 'processing', 'completed')
      GROUP BY mode, source_bucket, status
    `);
    const rows = result.rows as Array<{mode:string;bucket:string;status:string;count:number}>;
    const manualUsed = rows.filter(row => row.bucket === "monthly_manual")
      .reduce((sum, row) => sum + Number(row.count), 0);
    const autonomousUsed = rows.filter(row => row.bucket === "monthly_autonomous")
      .reduce((sum, row) => sum + Number(row.count), 0);
    res.json({ month, plan: MUSIC_PLAN,
      manual: { used: manualUsed, monthlyLimit: MUSIC_PLAN.manualGenerationsPerMonth },
      autonomous: { used: autonomousUsed, monthlyLimit: MUSIC_PLAN.autonomousGenerationsPerMonth },
      availableToGenerate: false, entitlementVerified: false,
      purchasedBalance: null, // Requires a separate, verified purchases ledger.
      note: "Usage display only. Generation is not activated.",
    });
  } catch (error) {
    req.log.error({ err: error }, "Music usage read failed");
    res.status(503).json({ error: "MUSIC_USAGE_UNAVAILABLE" });
  }
});
// Reservation is implemented as the Neon function echo_music_reserve_monthly.
// It acquires a per-owner advisory transaction lock, checks monthly limits and
// autonomous cooldown, and refuses calls without verified entitlement. Failed
// jobs do not count toward monthly usage. Provider charges, if any, must be
// reconciled separately. Never accept entitlement from clients.
// The Neon echo_music_finish_job function finalizes a job exactly once,
// marking success only after a validated private audio path exists. Failed
// jobs release the reserved monthly allowance, but this does not imply that
// fal.ai reverses any charges already incurred.
// This read-only endpoint lets the owner check a job without exposing other users.
router.get("/music/generation/:id", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({ error: "INVALID_GENERATION_ID" }); return; }
  try {
    const result = await db.execute(sql`
      SELECT id, character_id AS "characterId", mode, status,
        created_at AS "createdAt", completed_at AS "completedAt",
        error_code AS "errorCode"
      FROM echo_music_generation_jobs
      WHERE id = ${id.data}::uuid AND owner_id = ${req.userId!}
      LIMIT 1
    `);
    if (!result.rows.length) { res.status(404).json({ error: "GENERATION_NOT_FOUND" }); return; }
    res.json({ job: result.rows[0] });
  } catch (error) {
    req.log.error({ err: error }, "Music generation status read failed");
    res.status(503).json({ error: "MUSIC_GENERATION_STATUS_UNAVAILABLE" });
  }
});
// Authenticated playback of generated tracks, scoped to the job owner.
// This intentionally does not expose Supabase service credentials or URLs.
router.get("/music/generation/:id/audio", async (req, res) => {
  const parsed = z.string().uuid().safeParse(req.params.id);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_GENERATION_ID" }); return; }
  try {
    const result = await db.execute(sql`
      SELECT audio_path FROM echo_music_generation_jobs
      WHERE id = ${parsed.data}::uuid AND owner_id = ${req.userId!}
        AND status='completed' AND audio_path IS NOT NULL LIMIT 1
    `);
    const key = result.rows[0]?.audio_path;
    if (typeof key !== "string") { res.status(404).json({ error: "GENERATED_AUDIO_NOT_FOUND" }); return; }
    const upstream = await fetchPrivateGeneratedMusic(key, req.headers.range);
    res.status(upstream.status);
    for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
      const value = upstream.headers.get(header);
      if (value) res.setHeader(header, value);
    }
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    if (!upstream.body) { res.end(); return; }
    const { Readable } = await import("node:stream");
    const stream = Readable.fromWeb(upstream.body as import("node:stream/web").ReadableStream);
    stream.on("error", error => {
      req.log.warn({ err: error }, "Generated music playback interrupted");
      if (!res.headersSent) res.status(502).end(); else res.destroy(error);
    });
    stream.pipe(res);
  } catch (error) {
    req.log.error({ err: error }, "Generated music playback failed");
    if (!res.headersSent) res.status(503).json({ error: "GENERATED_AUDIO_UNAVAILABLE" });
  }
});
router.get("/music/status", async (req, res) => {
  let paidTestEnabled = false;
  let testAlreadyUsed = false;
  if (process.env.ECHO_MUSIC_PAID_TEST_ENABLED === 'true') {
    try {
      const founder = await db.execute(sql`SELECT 1 FROM echo_music_entitlements
        WHERE owner_id=${req.userId!} AND status='active' AND provider='founder_grant' LIMIT 1`);
      paidTestEnabled = founder.rows.length > 0;
      if (paidTestEnabled) {
        const prior = await db.execute(sql`SELECT 1 FROM echo_music_generation_jobs WHERE owner_id=${req.userId!} LIMIT 1`);
        testAlreadyUsed = prior.rows.length > 0;
      }
    } catch (error) { req.log.warn({err:error}, 'Music test eligibility unavailable'); }
  }
  res.json({
    addon: "echo_music",
    paidTestEnabled: paidTestEnabled && !testAlreadyUsed,
    testAlreadyUsed,
    addonRequired: true,
    activated: paidTestEnabled,
    generationEnabled: paidTestEnabled && !testAlreadyUsed,
    provider: "fal_ai_mureka_v8",
    model: "mureka/v8/generate/song",
    providerConfigured: Boolean(process.env.FAL_KEY?.trim()),
    providerRequestsEnabled: paidTestEnabled,
    configurationReady: Boolean(process.env.FAL_KEY?.trim()),
    liveGenerationBlockedBy: paidTestEnabled ? [] : ["music_addon_not_publicly_activated"],
    creditsSharedWithVoices: false,
    commercialMusicPlaybackSeparate: true,
    features: {
      instrumental: true,
      vocals: true,
      lyrics: true,
      characterSingingVoice: "saved_id_supported_provider_result_unverified",
      publishAndShare: "private_library_supported",
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
  requireConfiguredVoice: z.boolean().default(false),
}).strict();
function composeMurekaRequest(draft: z.infer<typeof musicGenerationRequest>) {
  const style = [draft.description, draft.genre && `Genre: ${draft.genre}`,
    draft.mood && `Mood: ${draft.mood}`,
    draft.instruments.length && `Instruments: ${draft.instruments.join(", ")}`,
    draft.vocalMode === "instrumental" ? "Instrumental music, no vocals." : `Singing in ${draft.language}.`,
  ].filter(Boolean).join("\n");
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
    provider: "fal_ai_mureka_v8", model: parsed.data.vocalMode === "instrumental" ? "mureka/v8/generate/instrumental" : "mureka/v8/generate/song",
    status: "dry_run", activated: false, charged: false,
    credentialsConfigured: Boolean(process.env.FAL_KEY?.trim()),
    request: parsed.data.vocalMode === "instrumental" ? { prompt: [parsed.data.description, parsed.data.genre, parsed.data.mood, parsed.data.instruments.join(", ")].filter(Boolean).join("; ").slice(0, 2000) } : composeMurekaRequest(parsed.data),
    endpoint: parsed.data.vocalMode === "instrumental" ? "mureka/v8/generate/instrumental" : "mureka/v8/generate/song",
    durationIsEstimate: true,
    note: "Preview only. No fal.ai API call or credit debit was made.",
  });
});
// Safe production preflight. No provider request and no credit reservation.
// An operator can verify readiness without exposing secrets or spending money.
router.get("/music/generate/preflight", async (req, res) => {
  try {
    const providerConfigured = Boolean(process.env.FAL_KEY?.trim());
    const storageConfigured = Boolean(process.env.SUPABASE_URL?.trim()
      && process.env.SUPABASE_SERVICE_ROLE_KEY?.trim());
    const checks = await db.execute(sql`
      SELECT
        to_regprocedure('echo_music_reserve_monthly(uuid,text,text,text,boolean)') IS NOT NULL AS reservation_available,
        to_regclass('public.echo_music_generation_jobs') IS NOT NULL AS jobs_available,
        to_regclass('public.echo_music_library') IS NOT NULL AS library_available
    `);
    const row = checks.rows[0] as Record<string, unknown> | undefined;
    const databaseReady = Boolean(row?.reservation_available && row?.jobs_available && row?.library_available);
    const entitlementReady = false; // Must be verified from a trusted billing webhook/ledger.
    res.json({
      providerConfigured, storageConfigured, databaseReady, entitlementReady,
      paidGenerationEnabled: false,
      readyForPaidTest: false,
      blockers: [
        ...(!providerConfigured ? ['fal_key_missing'] : []),
        ...(!storageConfigured ? ['private_storage_missing'] : []),
        ...(!databaseReady ? ['database_reservation_missing'] : []),
        'verified_music_entitlement_missing',
        'generation_endpoint_not_activated',
      ],
      paidCallsMadeByThisCheck: 0,
    });
  } catch (error) {
    req.log.error({ err: error }, "Music preflight failed");
    res.status(503).json({ error: "MUSIC_PREFLIGHT_UNAVAILABLE", paidCallsMadeByThisCheck: 0 });
  }
});
// Founder-only, one-time paid integration test. Disabled unless the operator
// explicitly enables it in server configuration; never trusts client entitlements.
router.post("/music/generate", async (req, res) => {
  if (process.env.ECHO_MUSIC_PAID_TEST_ENABLED !== 'true') {
    res.status(503).json({ error: 'ECHO_MUSIC_NOT_ACTIVATED', charged: false }); return;
  }
  const parsed = musicGenerationRequest.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({error:'INVALID_MUSIC_DRAFT'}); return; }
  try {
    const access = await db.execute(sql`
      SELECT provider FROM echo_music_entitlements
      WHERE owner_id=${req.userId!} AND status='active'
        AND provider='founder_grant'
    `);
    if (!access.rows.length) { res.status(403).json({error:'FOUNDER_TEST_ONLY'}); return; }
    const previous = await db.execute(sql`
      SELECT COUNT(*)::integer AS count FROM echo_music_generation_jobs
      WHERE owner_id=${req.userId!}
    `);
    if (Number(previous.rows[0]?.count ?? 0) > 0) {
      res.status(409).json({error:'ONE_TIME_TEST_ALREADY_USED'}); return;
    }
    const draft = parsed.data;
    const provider = composeMurekaRequest(draft);
    const characterId = draft.characterId;
    if (!characterId) { res.status(400).json({error:'CHARACTER_REQUIRED'}); return; }
    let savedVocalId: string | undefined;
    try {
      savedVocalId = await resolveCharacterSingingVoice(req.userId!, characterId, {
        instrumental: draft.vocalMode === 'instrumental',
        requireConfiguredVoice: draft.requireConfiguredVoice,
      });
    } catch (error) {
      if (error instanceof Error && error.message === 'CHARACTER_SINGING_VOICE_NOT_CONFIGURED') {
        res.status(409).json({error:'CHARACTER_SINGING_VOICE_NOT_CONFIGURED',charged:false}); return;
      }
      throw error;
    }
    const jobInput = {
      ownerId: req.userId!, characterId, mode: 'manual' as const,
      vocalId: savedVocalId,
      title: draft.title, verifiedEntitlement: true, prompt: provider.prompt,
      lyrics: 'lyrics' in provider ? provider.lyrics : undefined,
      instrumental: draft.vocalMode === 'instrumental',
    };
    const job = await reserveMusicJob(jobInput);
    try {
      await submitReservedMusicJob(jobInput, job.jobId);
    } catch (error) {
      req.log.error({err:error,jobId:job.jobId}, 'Music submission uncertain; manual reconciliation required');
      res.status(502).json({error:'MUSIC_SUBMISSION_REQUIRES_RECONCILIATION',jobId:job.jobId});
      return;
    }
    res.status(202).json({jobId:job.jobId,status:'processing',paidProviderRequestSubmitted:true});
  } catch (error) {
    req.log.error({err:error},'Founder music test failed');
    res.status(503).json({error:'MUSIC_TEST_UNAVAILABLE'});
  }
});
router.post("/music/generation/:id/sync", async (req, res) => {
  const id = z.string().uuid().safeParse(req.params.id);
  if (!id.success) { res.status(400).json({error:'INVALID_GENERATION_ID'}); return; }
  try {
    const job = await db.execute(sql`
      SELECT instrumental FROM echo_music_generation_jobs
      WHERE id=${id.data}::uuid AND owner_id=${req.userId!} LIMIT 1
    `);
    if (!job.rows.length) { res.status(404).json({error:'MUSIC_JOB_NOT_FOUND'}); return; }
    const model = job.rows[0].instrumental === true ? MUREKA_INSTRUMENTAL_MODEL : MUREKA_SONG_MODEL;
    const result = await pollMusicJob(req.userId!, id.data, model);
    res.json(result);
  } catch (error) {
    req.log.error({err:error},'Music sync failed');
    res.status(503).json({error:'MUSIC_SYNC_UNAVAILABLE'});
  }
});

export default router;
