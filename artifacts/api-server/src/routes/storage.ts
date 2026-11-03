import {
  ClaimUploadBody,
  ClaimUploadResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db, echoMediaTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { pipeMedia } from "../lib/pipeMedia";
import { Router, type IRouter, type RequestHandler } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectPermission } from "../lib/objectAcl";
import { mediaLimits, validMediaHeader } from "../lib/mediaSafety";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";
import { canReadSocialMedia, type SocialContentViewer } from "../lib/socialContentAccess";
import { z } from "zod";

type StorageAdapter = Pick<
  ObjectStorageService,
  "getObjectEntityUploadURL" |
  "normalizeObjectEntityPath" |
  "trySetObjectEntityAclPolicy" |
  "getObjectEntityFile" |
  "canAccessObjectEntity" |
  "downloadObject"
>;
type StorageRouterOptions = {
  authenticate?: RequestHandler;
  storage?: StorageAdapter;
};

const viewerQuerySchema = z.object({
  viewerUniverseId: z.string().trim().min(1).max(120).optional(),
  viewerCharacterId: z.string().trim().min(1).max(120).optional(),
  sourceUniverseId: z.string().trim().min(1).max(120).optional(),
  sourceCharacterId: z.string().trim().min(1).max(120).optional(),
  sourceType: z.enum(["post", "story", "avatar"]).optional(),
  sourceContentId: z.string().trim().min(1).max(160).optional(),
}).strict().refine((value) =>
  Boolean(value.viewerUniverseId) === Boolean(value.viewerCharacterId),
).refine((value) => {
  const sourceParts = [
    value.sourceUniverseId,
    value.sourceCharacterId,
    value.sourceType,
    value.sourceContentId,
  ];
  return sourceParts.every(Boolean) || sourceParts.every((part) => !part);
});

/** Uploads remain owner-only; only media attached to readable social content can be shared. */
export function createStorageRouter(options: StorageRouterOptions = {}): IRouter {
  const router: IRouter = Router();
  const storage = options.storage ?? new ObjectStorageService();
  const authenticate = options.authenticate ?? requireAuth;

  router.post(
  "/storage/uploads/request-url",
  authenticate,
  async (req, res): Promise<void> => {
    const parsed = RequestUploadUrlBody.safeParse(req.body);
    if (!parsed.success || parsed.data.size > mediaLimits[parsed.data.contentType] * 1024 * 1024) {
      res.status(400).json({ error: "Invalid image metadata" });
      return;
    }

    try {
      const uploadURL = await storage.getObjectEntityUploadURL();
      const objectPath = storage.normalizeObjectEntityPath(uploadURL);
      await db.insert(echoMediaTable).values({
        objectPath,
        ownerId: req.userId!,
      });

      res.json(
        RequestUploadUrlResponse.parse({
          uploadURL,
          objectPath,
        }),
      );
    } catch (error) {
      req.log.error({ err: error }, "Could not create a private image upload");
      res.status(500).json({ error: "Could not create image upload" });
    }
  },
);

  router.post(
  "/storage/uploads/claim",
  authenticate,
  async (req, res): Promise<void> => {
    const parsed = ClaimUploadBody.safeParse(req.body);
    if (!parsed.success || !/^\/objects\/uploads\/[a-f0-9-]+$/i.test(parsed.data.objectPath)) {
      res.status(400).json({ error: "Invalid object path" });
      return;
    }

    const [media] = await db
      .select({ objectPath: echoMediaTable.objectPath })
      .from(echoMediaTable)
      .where(
        and(
          eq(echoMediaTable.objectPath, parsed.data.objectPath),
          eq(echoMediaTable.ownerId, req.userId!),
        ),
      )
      .limit(1);
    if (!media) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    try {
      const file = await storage.getObjectEntityFile(media.objectPath);
      const [metadata] = await file.getMetadata();
      const mime = (metadata.contentType ?? '').split(';')[0].trim().toLowerCase();
      if (!mediaLimits[mime] || Number(metadata.size) < 1 || Number(metadata.size) > mediaLimits[mime] * 1024 * 1024) {
        res.status(400).json({ error: 'Formato o tamaño no permitido. Fotos/audio: 15 MB; video: 50 MB.' });
        return;
      }
      const [header] = await file.download({ start: 0, end: 63, validation: false });
      if (!validMediaHeader(header, mime)) {
        res.status(400).json({ error: 'El contenido del archivo no coincide con su formato.' });
        return;
      }
      const objectPath = await storage.trySetObjectEntityAclPolicy(
        media.objectPath,
        { owner: req.userId!, visibility: "private" },
      );
      res.json(ClaimUploadResponse.parse({ objectPath }));
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Uploaded image not found" });
        return;
      }
      req.log.error({ err: error }, "Could not protect uploaded image");
      res.status(500).json({ error: "Could not protect uploaded image" });
    }
  },
);

  router.use("/storage/objects", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Authorization");
    res.vary("Cookie");
    next();
  });
  router.get(
  "/storage/objects/*objectPath",
  authenticate,
  async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const rawPath = req.params.objectPath;
    const objectPath = `/objects/${Array.isArray(rawPath) ? rawPath.join("/") : rawPath}`;
    const parsedViewer = viewerQuerySchema.safeParse(req.query);
    if (!parsedViewer.success) {
      res.status(400).json({ error: "INVALID_MEDIA_VIEWER" });
      return;
    }
    const viewer: SocialContentViewer | undefined = parsedViewer.data.viewerUniverseId
      ? {
        universeId: parsedViewer.data.viewerUniverseId,
        characterId: parsedViewer.data.viewerCharacterId!,
      }
      : undefined;
    const source = parsedViewer.data.sourceUniverseId
      ? {
        universeId: parsedViewer.data.sourceUniverseId,
        characterId: parsedViewer.data.sourceCharacterId!,
        contentType: parsedViewer.data.sourceType!,
        contentId: parsedViewer.data.sourceContentId!,
      }
      : undefined;
    const [media] = await db
      .select({ objectPath: echoMediaTable.objectPath, ownerId: echoMediaTable.ownerId })
      .from(echoMediaTable)
      .where(eq(echoMediaTable.objectPath, objectPath))
      .limit(1);
    if (!media) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    const authorized = await canReadSocialMedia(
      req.userId!,
      media.ownerId,
      objectPath,
      source,
      viewer,
    );
    if (!authorized) {
      res.status(404).json({ error: "Image not found" });
      return;
    }

    try {
      const file = await storage.getObjectEntityFile(media.objectPath);
      // Keep the object-store ACL as a second check for direct owner reads.
      // Cross-owner delivery is only through this authenticated, no-store
      // proxy after character-level DB authorization above.
      if (media.ownerId === req.userId!) {
        const ownerCanRead = await storage.canAccessObjectEntity({
          userId: req.userId!,
          objectFile: file,
          requestedPermission: ObjectPermission.READ,
        });
        if (!ownerCanRead) {
          res.status(404).json({ error: "Image not found" });
          return;
        }
      }
      const response = await storage.downloadObject(file, 0, req.headers.range);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("Cache-Control", "private, no-store");
      res.status(response.status);
      if (response.body) {
        pipeMedia(response.body, res, error => req.log.warn({ err: error }, 'Private media stream interrupted'));
      } else {
        res.end();
      }
    } catch (error) {
      if (error instanceof ObjectNotFoundError) {
        res.status(404).json({ error: "Image not found" });
        return;
      }
      req.log.error({ err: error }, "Could not serve private image");
      res.status(500).json({ error: "Could not serve image" });
    }
    },
  );

  return router;
}

export default createStorageRouter();
