import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { db, echoMediaTable, pool } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { ClaimUploadBody, ClaimUploadResponse, RequestUploadUrlBody, RequestUploadUrlResponse } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { mediaLimits, validMediaHeader } from "../lib/mediaSafety";
import { canReadSocialMedia } from "../lib/socialContentAccess";

const bucket = "echo-media";
const config = () => {
  const base = process.env.SUPABASE_URL?.replace(/\/$/, "");
  const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!base || !/^https:\/\/[a-z0-9-]+\.supabase\.co$/.test(base) || !key) throw Error("SUPABASE_NOT_CONFIGURED");
  return { base, key };
};
const authHeaders = (key: string) => ({ Authorization: `Bearer ${key}`, apikey: key });
const pathFor = (id: string) => `uploads/${id}`;
const storageUrl = (base: string, path: string) => `${base}/storage/v1/object/${bucket}/${path}`;
const validPath = (path: string) => /^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(path);

export function createSupabaseStorageRouter(): IRouter {
  const router: IRouter = Router();
  router.post("/storage/uploads/request-url", requireAuth, async (req, res) => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success || !mediaLimits[parsed.data.contentType] ||
      parsed.data.size > mediaLimits[parsed.data.contentType] * 1024 * 1024 ||
      !parsed.data.size) { res.status(400).json({ error: "INVALID_MEDIA" }); return; }
    try {
      const { base, key } = config();
      const path = pathFor(randomUUID());
      const signed = await fetch(`${base}/storage/v1/object/upload/sign/${bucket}/${path}`, {
        method: "POST", headers: { ...authHeaders(key), "Content-Type": "application/json" },
        body: JSON.stringify({ upsert: false }), signal: AbortSignal.timeout(10000),
      });
      if (!signed.ok) {
        const detail = (await signed.text()).slice(0, 500);
        req.log.error({ status: signed.status, detail }, "Supabase upload signing failed");
        res.status(502).json({ error: "STORAGE_SIGN_FAILED", upstreamStatus: signed.status });
        return;
      }
      const payload = await signed.json() as { url?: string; signedURL?: string; token?: string };
      const relative = payload.url ?? payload.signedURL;
      let uploadURL: string | null = null;
      if (relative) {
        // Supabase may return /object/upload/sign/..., /storage/v1/object/..., or an absolute URL.
        const normalized = relative.startsWith("http")
          ? relative
          : `${base}/storage/v1/${relative.replace(/^\/?(?:storage\/v1\/)?/, "")}`;
        try {
          const candidate = new URL(normalized);
          if (candidate.origin === new URL(base).origin &&
              candidate.pathname.startsWith("/storage/v1/object/upload/sign/")) {
            uploadURL = candidate.toString();
          }
        } catch { /* Reject malformed signed URLs. */ }
      } else if (payload.token) {
        uploadURL = `${base}/storage/v1/object/upload/sign/${bucket}/${path}?token=${encodeURIComponent(payload.token)}`;
      }
      if (!uploadURL) {
        req.log.error({ hasUrl: Boolean(relative), hasToken: Boolean(payload.token) }, "Supabase returned invalid signed upload URL");
        res.status(502).json({ error: "STORAGE_SIGN_INVALID" });
        return;
      }
      const objectPath = `/objects/${path}`;
      try {
        await db.insert(echoMediaTable).values({ ownerId: req.userId!, objectPath });
      } catch (error) {
        req.log.error({ err: error }, "Supabase media registration database failed");
        res.status(503).json({ error: "MEDIA_DATABASE_UNAVAILABLE" }); return;
      }
      res.json(RequestUploadUrlResponse.parse({ uploadURL, objectPath }));
    } catch (error) { req.log.error({ err: error }, "Supabase upload URL creation failed"); res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); }
  });

  router.post("/storage/uploads/claim", requireAuth, async (req, res) => {
    const parsed = ClaimUploadBody.safeParse(req.body);
    if (!parsed.success || !validPath(parsed.data.objectPath)) {
      res.status(400).json({ error: "INVALID_MEDIA_PATH" }); return;
    }
    try {
      const [owned] = await db.select().from(echoMediaTable).where(and(
        eq(echoMediaTable.ownerId, req.userId!), eq(echoMediaTable.objectPath, parsed.data.objectPath))).limit(1);
      if (!owned) { res.status(404).json({ error: "MEDIA_NOT_FOUND" }); return; }
      const { base, key } = config();
      const response = await fetch(storageUrl(base, parsed.data.objectPath.slice("/objects/".length)), {
        headers: { ...authHeaders(key) }, signal: AbortSignal.timeout(15000),
      });
      if (!response.ok) { res.status(404).json({ error: "UPLOAD_NOT_FOUND" }); return; }
      const mime = (response.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
      const bytes = Buffer.from(await response.arrayBuffer());
      if (!mediaLimits[mime] || bytes.length < 1 || bytes.length > mediaLimits[mime] * 1024 * 1024 ||
        !validMediaHeader(bytes.subarray(0, 64), mime)) {
        res.status(400).json({ error: "INVALID_UPLOADED_FILE" }); return;
      }
      res.json(ClaimUploadResponse.parse({ objectPath: parsed.data.objectPath }));
    } catch { res.status(503).json({ error: "STORAGE_UNAVAILABLE" }); }
  });

  // Transcribe only media registered to the authenticated owner. The original
  // recording stays private in Supabase; Groq receives bytes only when configured.
  router.post("/storage/audio/transcribe", requireAuth, async (req, res) => {
    const objectPath = req.body?.objectPath;
    if (typeof objectPath !== "string" || !validPath(objectPath)) {
      res.status(400).json({ error: "INVALID_MEDIA_PATH" }); return;
    }
    const groqKey = process.env.GROQ_API_KEY;
    if (!groqKey) { res.status(503).json({ error: "TRANSCRIPTION_NOT_CONFIGURED" }); return; }
    try {
      const [owned] = await db.select().from(echoMediaTable).where(and(
        eq(echoMediaTable.ownerId, req.userId!), eq(echoMediaTable.objectPath, objectPath))).limit(1);
      if (!owned) { res.status(404).json({ error: "MEDIA_NOT_FOUND" }); return; }
      const { base, key } = config();
      const media = await fetch(storageUrl(base, objectPath.slice("/objects/".length)), {
        headers: authHeaders(key), signal: AbortSignal.timeout(20000),
      });
      if (!media.ok) { res.status(502).json({ error: "MEDIA_FETCH_FAILED" }); return; }
      const mime = (media.headers.get("content-type") ?? "").split(";")[0].toLowerCase();
      if (!["audio/mp4", "audio/mpeg", "audio/wav", "audio/webm", "audio/ogg"].includes(mime)) {
        res.status(415).json({ error: "AUDIO_FORMAT_UNSUPPORTED" }); return;
      }
      const bytes = Buffer.from(await media.arrayBuffer());
      if (!bytes.length || bytes.length > 15 * 1024 * 1024 || !validMediaHeader(bytes.subarray(0, 64), mime)) {
        res.status(400).json({ error: "INVALID_AUDIO" }); return;
      }
      const form = new FormData();
      const ext = ({ "audio/mp4": "m4a", "audio/mpeg": "mp3", "audio/wav": "wav",
        "audio/webm": "webm", "audio/ogg": "ogg" } as Record<string, string>)[mime];
      form.append("file", new Blob([new Uint8Array(bytes)], { type: mime }), `voice.${ext}`);
      form.append("model", "whisper-large-v3-turbo");
      form.append("language", "es");
      form.append("response_format", "json");
      const result = await fetch("https://api.groq.com/openai/v1/audio/transcriptions", {
        method: "POST", headers: { Authorization: `Bearer ${groqKey}` }, body: form,
        signal: AbortSignal.timeout(60000),
      });
      if (!result.ok) {
        req.log.warn({ upstreamStatus: result.status }, "Audio transcription failed");
        res.status(result.status === 429 ? 429 : 502).json({ error: "TRANSCRIPTION_PROVIDER_FAILED" }); return;
      }
      const data = await result.json() as { text?: unknown };
      const transcript = typeof data.text === "string" ? data.text.trim().slice(0, 10000) : "";
      if (!transcript) { res.status(422).json({ error: "AUDIO_NOT_UNDERSTOOD" }); return; }
      res.json({ transcript });
    } catch (error) {
      req.log.warn({ err: error }, "Audio transcription unavailable");
      res.status(503).json({ error: "TRANSCRIPTION_UNAVAILABLE" });
    }
  });

  router.get("/storage/objects/*objectPath", requireAuth, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.setHeader("X-Content-Type-Options", "nosniff");
    const raw = req.params.objectPath;
    const objectPath = `/objects/${Array.isArray(raw) ? raw.join("/") : raw}`;
    if (!validPath(objectPath)) { res.status(404).end(); return; }
    try {
      const [media] = await db.select().from(echoMediaTable).where(eq(echoMediaTable.objectPath, objectPath)).limit(1);
      if (!media) { res.status(404).end(); return; }
      const query = req.query;
      const string = (v: unknown) => typeof v === "string" ? v : undefined;
      const viewerUniverseId = string(query.viewerUniverseId), viewerCharacterId = string(query.viewerCharacterId);
      const sourceUniverseId = string(query.sourceUniverseId), sourceCharacterId = string(query.sourceCharacterId);
      const sourceType = string(query.sourceType), sourceContentId = string(query.sourceContentId);
      const viewer = viewerUniverseId && viewerCharacterId ? { universeId: viewerUniverseId, characterId: viewerCharacterId } : undefined;
      const source = sourceUniverseId && sourceCharacterId && sourceContentId &&
        (sourceType === "post" || sourceType === "story" || sourceType === "avatar" || sourceType === "message")
        ? { universeId: sourceUniverseId, characterId: sourceCharacterId, contentId: sourceContentId, contentType: sourceType as "post" | "story" | "avatar" | "message" } : undefined;
      if (Boolean(viewerUniverseId) !== Boolean(viewerCharacterId) ||
        [sourceUniverseId, sourceCharacterId, sourceType, sourceContentId].filter(Boolean).length % 4 !== 0) {
        res.status(400).end(); return;
      }
      // Private voice notes can be read only by their sender or intended
      // recipient, provided neither account has blocked the other.
      const voiceAccess = await pool.query(
        `SELECT 1 FROM echo_creator_voice_messages v
         WHERE v.object_path=$1 AND v.sender_owner_id=$2
           AND ($3=v.sender_owner_id OR $3=v.recipient_owner_id)
           AND NOT EXISTS (
             SELECT 1 FROM echo_creator_blocks b
             WHERE (b.blocker_owner_id=v.sender_owner_id AND b.blocked_owner_id=v.recipient_owner_id)
                OR (b.blocker_owner_id=v.recipient_owner_id AND b.blocked_owner_id=v.sender_owner_id)
           ) LIMIT 1`,
        [objectPath, media.ownerId, req.userId],
      );
      if (!voiceAccess.rowCount && !await canReadSocialMedia(req.userId!, media.ownerId, objectPath, source, viewer)) {
        res.status(404).end(); return;
      }
      const { base, key } = config();
      const response = await fetch(storageUrl(base, objectPath.slice("/objects/".length)), {
        headers: { ...authHeaders(key), ...(req.headers.range ? { Range: req.headers.range } : {}) },
        signal: AbortSignal.timeout(30000),
      });
      if (!response.ok) { res.status(response.status === 404 ? 404 : 502).end(); return; }
      res.status(response.status);
      for (const header of ["content-type", "content-length", "content-range", "accept-ranges"]) {
        const value = response.headers.get(header);
        if (value) res.setHeader(header, value);
      }
      if (!response.body) { res.end(); return; }
      const { Readable } = await import("node:stream");
      Readable.fromWeb(response.body as import("node:stream/web").ReadableStream).pipe(res);
    } catch { if (!res.headersSent) res.status(503).end(); }
  });
  return router;
}
