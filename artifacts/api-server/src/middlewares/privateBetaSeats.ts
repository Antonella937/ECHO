import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { RequestHandler } from "express";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";

/** Configurable persistent beta seats (3–50), allocated atomically across concurrent server instances. */
const configuredSeatLimit = Number(process.env.ECHO_BETA_MAX_SEATS ?? "3");
if (!Number.isInteger(configuredSeatLimit) || configuredSeatLimit < 1 || configuredSeatLimit > 50) {
  throw new Error("ECHO_BETA_MAX_SEATS must be an integer from 1 to 50");
}

// Optional invitation allowlist. When configured, only explicitly invited Clerk IDs can claim seats.
const invitedIdsRaw = process.env.ECHO_BETA_INVITED_USER_IDS?.trim() ?? "";
const invitedIds = new Set(invitedIdsRaw.split(",").map(id => id.trim()).filter(Boolean));
if (invitedIdsRaw && (invitedIds.size > configuredSeatLimit ||
  [...invitedIds].some(id => !/^user_[A-Za-z0-9]+$/.test(id)))) {
  throw new Error("ECHO_BETA_INVITED_USER_IDS must contain valid unique Clerk IDs within the seat limit");
}

export const privateBetaSeats: RequestHandler = async (req, res, next) => {
  if (req.path === "/healthz") return next();
  res.setHeader("Cache-Control", "private, no-store");
  const ownerId = getAuth(req).userId;
  if (!ownerId) { res.status(401).json({ error: "Authentication required" }); return; }
  if (process.env.ECHO_BETA_APPROVAL_REQUIRED === "true" && lifetimeAccessForOwner(ownerId) === null) {
    try {
      const approved = await db.execute(sql`SELECT 1 FROM echo_beta_approvals WHERE owner_id = ${ownerId} AND status = 'approved' LIMIT 1`);
      if (approved.rows.length === 0) {
        res.status(403).json({ error: "PRIVATE_BETA_APPROVAL_REQUIRED" }); return;
      }
    } catch { res.status(503).json({ error: "PRIVATE_BETA_APPROVAL_UNAVAILABLE" }); return; }
  }
  if (invitedIdsRaw && !invitedIds.has(ownerId) && lifetimeAccessForOwner(ownerId) === null) {
    res.status(403).json({ error: "PRIVATE_BETA_INVITATION_REQUIRED" }); return;
  }
  try {
    const admitted = await db.transaction(async tx => {
      // The same transaction-level lock serializes all seat claims, even across servers.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(21847, 3)`);
      const existing = await tx.execute(sql`SELECT owner_id FROM echo_beta_seats WHERE owner_id = ${ownerId}`);
      if (existing.rows.length > 0) return true;
      const claimed = await tx.execute(sql`
        INSERT INTO echo_beta_seats (owner_id)
        SELECT ${ownerId}
        WHERE (SELECT COUNT(*) FROM echo_beta_seats) < ${configuredSeatLimit}
        ON CONFLICT (owner_id) DO NOTHING
        RETURNING owner_id
      `);
      return claimed.rows.length > 0;
    });
    if (!admitted) { res.status(403).json({ error: "PRIVATE_BETA_FULL" }); return; }
    next();
  } catch (error) {
    // Missing schema or unavailable DB must never allow an extra account through.
    res.status(503).json({ error: "PRIVATE_BETA_UNAVAILABLE" });
  }
};
