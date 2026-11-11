import { Router, type IRouter } from "express";
import { getAuth } from "@clerk/express";
import { pool } from "@workspace/db";
import { lifetimeAccessForOwner } from "../lib/lifetimeAccess";

/** Authenticated invitation applications, handled before the beta seat gate. */
export const betaApplicationsRouter: IRouter = Router();
betaApplicationsRouter.use((req, res, next) => {
  const ownerId = getAuth(req).userId;
  if (!ownerId) { res.status(401).json({ error: "Authentication required" }); return; }
  res.setHeader("Cache-Control", "private, no-store");
  next();
});
const isFounder = (id: string) => lifetimeAccessForOwner(id) === "owner_lifetime";
betaApplicationsRouter.post("/request", async (req, res) => {
  const ownerId = getAuth(req).userId!;
  try {
    const result = await pool.query(
      "INSERT INTO echo_beta_approvals(owner_id,status) VALUES($1,'pending') ON CONFLICT(owner_id) DO UPDATE SET updated_at=now() RETURNING status",
      [ownerId]);
    res.json({ status: result.rows[0].status });
  } catch { res.status(503).json({ error: "BETA_REQUEST_UNAVAILABLE" }); }
});
betaApplicationsRouter.get("/request", async (req, res) => {
  try {
    const result = await pool.query("SELECT status FROM echo_beta_approvals WHERE owner_id=$1", [getAuth(req).userId]);
    res.json({ status: result.rows[0]?.status ?? "not_requested" });
  } catch { res.status(503).json({ error: "BETA_REQUEST_UNAVAILABLE" }); }
});
betaApplicationsRouter.get("/admin/requests", async (req, res) => {
  if (!isFounder(getAuth(req).userId!)) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  try {
    const result = await pool.query("SELECT owner_id,status,created_at,updated_at FROM echo_beta_approvals ORDER BY created_at DESC LIMIT 100");
    res.json({ requests: result.rows });
  } catch { res.status(503).json({ error: "BETA_REQUEST_UNAVAILABLE" }); }
});
betaApplicationsRouter.post("/admin/requests/:ownerId/decision", async (req, res) => {
  if (!isFounder(getAuth(req).userId!)) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  const ownerId = req.params.ownerId;
  const status = req.body?.status;
  if (typeof ownerId !== "string" || !/^user_[A-Za-z0-9]{15,64}$/.test(ownerId) ||
      !["approved","rejected"].includes(status)) {
    res.status(400).json({ error: "INVALID_DECISION" }); return;
  }
  const client = await pool.connect();
  try {
    await client.query("BEGIN");
    await client.query("SELECT pg_advisory_xact_lock(21847, 3)");
    if (status === "approved") {
      const count = await client.query("SELECT COUNT(*)::int AS count FROM echo_beta_approvals WHERE status='approved'");
      const maxSeats = Number(process.env.ECHO_BETA_MAX_SEATS ?? "3");
      if (Number(count.rows[0].count) >= maxSeats) {
        const existing = await client.query("SELECT status FROM echo_beta_approvals WHERE owner_id=$1", [ownerId]);
        if (existing.rows[0]?.status !== "approved") {
          await client.query("ROLLBACK");
          res.status(409).json({ error: "PRIVATE_BETA_FULL" }); return;
        }
      }
    }
    const result = await client.query(
      "UPDATE echo_beta_approvals SET status=$1,updated_at=now() WHERE owner_id=$2 RETURNING owner_id,status",
      [status,ownerId]);
    if (!result.rowCount) { await client.query("ROLLBACK"); res.status(404).json({ error: "NOT_FOUND" }); return; }
    await client.query("COMMIT");
    res.json({ request: result.rows[0] });
  } catch { await client.query("ROLLBACK"); res.status(503).json({ error: "BETA_DECISION_UNAVAILABLE" }); }
  finally { client.release(); }
});
