import { Router, type IRouter } from "express";
import { z } from "zod";
import { eq } from "drizzle-orm";
import { db, echoInterfaceLanguagesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

const languageSchema = z.enum(["es", "en", "pt", "fr", "de", "it", "ko", "ja", "zh"]);
export const interfaceLanguageRouter: IRouter = Router();
interfaceLanguageRouter.get("/account/interface-language", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  try {
    const [row] = await db.select({ language: echoInterfaceLanguagesTable.language })
      .from(echoInterfaceLanguagesTable)
      .where(eq(echoInterfaceLanguagesTable.ownerId, req.userId!)).limit(1);
    res.json({ language: row?.language ?? null });
  } catch { res.status(503).json({ error: "LANGUAGE_SYNC_UNAVAILABLE" }); }
});
interfaceLanguageRouter.put("/account/interface-language", requireAuth, async (req, res) => {
  res.setHeader("Cache-Control", "private, no-store");
  const parsed = z.object({ language: languageSchema }).strict().safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_LANGUAGE" }); return; }
  try {
    await db.insert(echoInterfaceLanguagesTable).values({ ownerId: req.userId!, language: parsed.data.language })
      .onConflictDoUpdate({ target: echoInterfaceLanguagesTable.ownerId, set: { language: parsed.data.language, updatedAt: new Date() } });
    res.json({ language: parsed.data.language });
  } catch { res.status(503).json({ error: "LANGUAGE_SYNC_UNAVAILABLE" }); }
});
