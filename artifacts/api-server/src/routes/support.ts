import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { isSupportAdmin, validSupportSubmission, validSupportUpdate } from "../lib/supportPolicy";

const router: IRouter = Router();

router.use("/support", requireAuth);

router.post("/support/tickets", async (req, res): Promise<void> => {
  if (!validSupportSubmission(req.body)) {
    res.status(400).json({ error: "INVALID_TICKET" }); return;
  }
  const { category, area, description } = req.body;
  try {
    const id = randomUUID();
    const result = await pool.query(
      "INSERT INTO echo_support_tickets (id,owner_id,category,area,description) VALUES ($1,$2,$3,$4,$5) RETURNING id,status,created_at",
      [id, req.userId, category, area ?? "", description.trim()]);
    res.status(201).json({ ticket: result.rows[0] });
  } catch { res.status(503).json({ error: "SUPPORT_UNAVAILABLE" }); }
});

router.get("/support/tickets", async (req, res): Promise<void> => {
  try {
    const result = await pool.query(
      "SELECT id,category,area,description,status,created_at,updated_at FROM echo_support_tickets WHERE owner_id=$1 ORDER BY created_at DESC LIMIT 100",
      [req.userId]);
    res.json({ tickets: result.rows });
  } catch { res.status(503).json({ error: "SUPPORT_UNAVAILABLE" }); }
});

router.get("/support/admin/tickets", async (req, res): Promise<void> => {
  if (!isSupportAdmin(req.userId, process.env.ECHO_ADMIN_USER_IDS)) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  try {
    const result = await pool.query(
      "SELECT id,owner_id,category,area,description,status,admin_note,created_at,updated_at FROM echo_support_tickets ORDER BY created_at DESC LIMIT 200");
    res.json({ tickets: result.rows });
  } catch { res.status(503).json({ error: "SUPPORT_UNAVAILABLE" }); }
});

router.patch("/support/admin/tickets/:id", async (req, res): Promise<void> => {
  if (!isSupportAdmin(req.userId, process.env.ECHO_ADMIN_USER_IDS)) { res.status(403).json({ error: "FORBIDDEN" }); return; }
  if (!validSupportUpdate(req.body)) {
    res.status(400).json({ error: "INVALID_UPDATE" }); return;
  }
  const { status, adminNote } = req.body;
  const ticketId = req.params.id;
  if (typeof ticketId !== "string" || !/^[0-9a-f]{8}-[0-9a-f]{4}-[1-8][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i.test(ticketId)) {
    res.status(400).json({ error: "INVALID_TICKET_ID" }); return;
  }
  try {
    const result = await pool.query(
      "UPDATE echo_support_tickets SET status=$1,admin_note=COALESCE($2,admin_note),updated_at=now() WHERE id=$3 RETURNING id,status,admin_note,updated_at",
      [status, adminNote ?? null, ticketId]);
    if (!result.rowCount) { res.status(404).json({ error: "NOT_FOUND" }); return; }
    res.json({ ticket: result.rows[0] });
  } catch { res.status(503).json({ error: "SUPPORT_UNAVAILABLE" }); }
});
export default router;
