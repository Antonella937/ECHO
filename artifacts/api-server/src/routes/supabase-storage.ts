import { randomUUID } from "node:crypto";
import { Router, type IRouter } from "express";
import { db, echoMediaTable } from "@workspace/db";
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
        ? { universeId: sourceUniverseId, characterId: sourceCharacterId, contentId: sourceContentId, contentType: sourceType } : undefined;
      if (Boolean(viewerUniverseId) !== Boolean(viewerCharacterId) ||
        [sourceUniverseId, sourceCharacterId, sourceType, sourceContentId].filter(Boolean).length % 4 !== 0) {
        res.status(400).end(); return;
      }
      if (!await canReadSocialMedia(req.userId!, media.ownerId, objectPath, source, viewer)) {
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
