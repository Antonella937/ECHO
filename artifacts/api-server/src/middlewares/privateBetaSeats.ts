import { getAuth } from "@clerk/express";
import { db } from "@workspace/db";
import { sql } from "drizzle-orm";
import type { RequestHandler } from "express";

/** Three persistent seats, allocated atomically across concurrent server instances. */
export const privateBetaSeats: RequestHandler = async (req, res, next) => {
  if (req.path === "/healthz") return next();
  res.setHeader("Cache-Control", "private, no-store");
  const ownerId = getAuth(req).userId;
  if (!ownerId) { res.status(401).json({ error: "Authentication required" }); return; }
  try {
    const admitted = await db.transaction(async tx => {
      // The same transaction-level lock serializes all seat claims, even across servers.
      await tx.execute(sql`SELECT pg_advisory_xact_lock(21847, 3)`);
      const existing = await tx.execute(sql`SELECT owner_id FROM echo_beta_seats WHERE owner_id = ${ownerId}`);
      if (existing.rows.length > 0) return true;
      const claimed = await tx.execute(sql`
        INSERT INTO echo_beta_seats (owner_id)
        SELECT ${ownerId}
        WHERE (SELECT COUNT(*) FROM echo_beta_seats) < 3
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
