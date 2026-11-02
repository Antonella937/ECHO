import {
  ClaimUploadBody,
  ClaimUploadResponse,
  RequestUploadUrlBody,
  RequestUploadUrlResponse,
} from "@workspace/api-zod";
import { db, echoMediaTable } from "@workspace/db";
import { and, eq } from "drizzle-orm";
import { Readable } from "node:stream";
import { Router, type IRouter } from "express";
import { requireAuth } from "../middlewares/requireAuth";
import { ObjectPermission } from "../lib/objectAcl";
import { mediaLimits, validMediaHeader } from "../lib/mediaSafety";
import {
  ObjectNotFoundError,
  ObjectStorageService,
} from "../lib/objectStorage";

const router: IRouter = Router();
const storage = new ObjectStorageService();

router.post(
  "/storage/uploads/request-url",
  requireAuth,
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
  requireAuth,
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

router.get(
  "/storage/objects/*objectPath",
  requireAuth,
  async (req, res): Promise<void> => {
    const rawPath = req.params.objectPath;
    const objectPath = `/objects/${Array.isArray(rawPath) ? rawPath.join("/") : rawPath}`;
    const [media] = await db
      .select({ objectPath: echoMediaTable.objectPath })
      .from(echoMediaTable)
      .where(
        and(
          eq(echoMediaTable.objectPath, objectPath),
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
      const allowed = await storage.canAccessObjectEntity({
        userId: req.userId!,
        objectFile: file,
        requestedPermission: ObjectPermission.READ,
      });
      if (!allowed) {
        res.status(404).json({ error: "Image not found" });
        return;
      }
      const response = await storage.downloadObject(file, 0, req.headers.range);
      response.headers.forEach((value, key) => res.setHeader(key, value));
      res.setHeader("Cache-Control", "private, no-store");
      res.status(response.status);
      if (response.body) {
        const stream = Readable.fromWeb(response.body as ReadableStream<Uint8Array>);
        stream.on('error', error => { req.log.warn({ err: error }, 'Private media stream interrupted'); res.destroy(); });
        res.on('close', () => stream.destroy());
        stream.pipe(res);
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

export default router;
