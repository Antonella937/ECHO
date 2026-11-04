import { getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { db, echoMediaTable, echoCharacterFollowRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOwnerConsent } from "../lib/ownerConsent";

/**
 * Installed before production API routers, after Clerk. Synthetic router-unit tests do not
 * imply this boundary was tested; dedicated HTTP tests mount it explicitly.
 * Draft acknowledgement allows owner-only alpha use, never external activation.
 */
export function createConsentSafetyGate(
  resolveOwner: (req: Request) => string | null | undefined = req => getAuth(req).userId,
): RequestHandler {
  return async (req, res, next) => {
    try {
      const ownerId = resolveOwner(req);
      if (!ownerId || req.path === "/creator/consent" || req.path === "/healthz") return next();
      res.setHeader("Cache-Control", "private, no-store");
      const unavailable = () => { res.status(404).json({ error: "Not found" }); };
      const path = req.path;
      // External exploration/list metadata cannot be made safe by merely checking a checkbox.
      if (path === "/social/feed") return unavailable();
      // Server-only restriction passed into the existing list query BEFORE pagination.
      res.locals.alphaInternalOnly = true;
      const target = path.match(/^\/social\/owners\/([^/]+)\//);
      if (target && decodeURIComponent(target[1]) !== ownerId) return unavailable();
      if (path === "/social/follows" && req.body?.targetOwnerId !== ownerId) return unavailable();
      const transition = path.match(/^\/social\/follow-requests\/([^/]+)\//);
      if (transition) {
        const [request] = await db.select().from(echoCharacterFollowRequestsTable)
          .where(eq(echoCharacterFollowRequestsTable.id, decodeURIComponent(transition[1]))).limit(1);
        if (!request || request.sourceOwnerId !== ownerId || request.targetOwnerId !== ownerId) return unavailable();
      }
      if (path.startsWith("/storage/objects/")) {
        const objectPath = `/objects/${decodeURIComponent(path.slice("/storage/objects/".length))}`;
        const [media] = await db.select({ ownerId: echoMediaTable.ownerId }).from(echoMediaTable)
          .where(eq(echoMediaTable.objectPath, objectPath)).limit(1);
        if (!media || media.ownerId !== ownerId) return unavailable();
        // Existing storage authorization still checks exact association, privacy and archives.
      }
      if ((/^\/universe\/[^/]+\/sharing$/.test(path) && req.body?.sharingEnabled === true) ||
        ((path.startsWith("/ai-engine/") || path.startsWith("/autonomy/")) && req.method !== "GET")) {
        res.status(409).json({ error: "LEGAL_DOCUMENTS_UNAVAILABLE", externalUseAllowed: false });
        return;
      }
      // Always allow reading and reducing sharing, including legacy owners with no draft row.
      if (["GET", "HEAD", "OPTIONS"].includes(req.method) ||
        (/^\/universe\/[^/]+\/sharing$/.test(path) && req.body?.sharingEnabled === false)) return next();
      if (!(await getOwnerConsent(ownerId)).draftAcknowledged) {
        res.status(403).json({ error: "ALPHA_ACKNOWLEDGEMENT_REQUIRED" });
        return;
      }
      next();
    } catch {
      res.status(503).json({ error: "CONSENT_CHECK_UNAVAILABLE" });
    }
  };
}
