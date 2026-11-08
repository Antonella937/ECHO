import { getAuth } from "@clerk/express";
import type { Request, RequestHandler } from "express";
import { db, echoMediaTable, echoCharacterFollowRequestsTable } from "@workspace/db";
import { eq } from "drizzle-orm";
import { getOwnerConsent } from "../lib/ownerConsent";
import { AUTONOMY_PRIVATE_BETA_ENABLED, isAutonomyOwnerAuthorized } from "../autonomy/constants";

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
      if (!ownerId || req.path === "/creator/consent" || req.path === "/healthz" || req.path.startsWith("/support/")) return next();
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
      // Image prompt preparation is a private, non-generating preview; it does not transfer media or spend credits.
      const safeImagePreview = req.method === "POST" && (path === "/ai-engine/images/prepare" || path === "/ai-engine/images/prepare-edit");
      // A private synthetic storage diagnostic makes no AI/provider calls. The route also enforces auth and its own allowlist.
      const safeStorageDiagnostic = req.method === "POST" && path === "/ai-engine/images/storage-self-test" &&
        process.env.ECHO_IMAGE_STORAGE_SELF_TEST_ENABLED === "true" &&
        (process.env.ECHO_IMAGE_GENERATION_ALLOWED_USER_IDS ?? "").split(",").map(id => id.trim()).includes(ownerId);
      // Private image generation is permitted only with a server-side owner allowlist,
      // active provider controls, and the exact per-request transfer acknowledgement.
      // Public AI endpoints remain blocked while legal documents are unavailable.
      const privateImageGeneration = req.method === "POST" && path === "/ai-engine/images/generate" &&
        process.env.ECHO_PAID_IMAGE_GENERATION_ENABLED === "true" &&
        process.env.ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED === "true" &&
        (process.env.ECHO_IMAGE_GENERATION_ALLOWED_USER_IDS ?? "").split(",").map(id => id.trim()).includes(ownerId) &&
        req.body?.imageTransferAcknowledgement === "image-transfer-preview-v1";
      const authorizedPrivateAutonomy = AUTONOMY_PRIVATE_BETA_ENABLED &&
        path.startsWith("/autonomy/") && isAutonomyOwnerAuthorized(ownerId);
      if ((/^\/universe\/[^/]+\/sharing$/.test(path) && req.body?.sharingEnabled === true) ||
        ((path.startsWith("/ai-engine/") || path.startsWith("/autonomy/")) && req.method !== "GET" && !authorizedPrivateAutonomy && !safeImagePreview && !safeStorageDiagnostic && !privateImageGeneration)) {
        res.status(409).json({ error: "LEGAL_DOCUMENTS_UNAVAILABLE", externalUseAllowed: false });
        return;
      }
      // Always allow reading and reducing sharing, including legacy owners with no draft row.
      if (authorizedPrivateAutonomy || safeStorageDiagnostic || ["GET", "HEAD", "OPTIONS"].includes(req.method) ||
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
