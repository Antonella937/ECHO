import { Router, type RequestHandler } from "express";
import { z } from "zod";
import { db, echoOwnerConsentsTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { ALPHA_CONSENT_VERSION, getOwnerConsent } from "../lib/ownerConsent";

const acknowledgement = z.object({
  version: z.literal(ALPHA_CONSENT_VERSION),
  adultDeclared: z.literal(true),
  fictionAcknowledged: z.literal(true),
  legalDraftAcknowledged: z.literal(true),
}).strict();

export function createOwnerConsentRouter(authenticate: RequestHandler = requireAuth) {
  const router = Router();
  router.get("/creator/consent", authenticate, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.json(await getOwnerConsent(req.userId!));
  });
  router.put("/creator/consent", authenticate, async (req, res) => {
    res.setHeader("Cache-Control", "private, no-store");
    const parsed = acknowledgement.safeParse(req.body);
    if (!parsed.success) {
      res.status(422).json({ error: "INVALID_DRAFT_ACKNOWLEDGEMENT" });
      return;
    }
    // DB timestamp, immutable first acknowledgement, separate row for every future version.
    await db.insert(echoOwnerConsentsTable).values({ ownerId: req.userId!, ...parsed.data }).onConflictDoNothing();
    res.json(await getOwnerConsent(req.userId!));
  });
  return router;
}
