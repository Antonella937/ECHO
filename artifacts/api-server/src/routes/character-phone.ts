import { Router } from "express";
import { sql } from "drizzle-orm";
import { z } from "zod";
import { db } from "@workspace/db";
import { EngineError } from "../ai-engine/contracts";
import { kindroidPeerGroupProvider } from "../ai-engine/kindroid";
import { sendKindroidSocialGroupContext, withGroupLock } from "../ai-engine/kindroid-social-group";
import { readUniverse } from "../lib/universeRepository";
import { requireAuth } from "../middlewares/requireAuth";

const router = Router();
const input = z.object({
  universeId: z.string().min(1).max(120),
  characterId: z.string().min(1).max(120),
  kind: z.enum(["pulse", "notes", "diary"]),
  draft: z.string().max(700),
  direction: z.string().max(300),
  replyContext: z.string().max(280),
}).strict();
const formats = {
  pulse: ["a natural short Pulse microblog post or reply", 280],
  notes: ["a short personal note", 500],
  diary: ["a first-person diary entry", 700],
} as const;

router.post("/character-phone/draft", requireAuth, async (req, res) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_PHONE_DRAFT" }); return; }
  const ownerId = req.userId!;
  const { universeId, characterId, kind, draft, direction, replyContext } = parsed.data;
  try {
    const universe = await readUniverse(ownerId, universeId);
    const state = universe.state as { characters?: Array<{ id: string; archived?: boolean; configuration?: { voice?: { outputLanguage?: string } } }> } | null;
    const account = state?.characters?.find(item => item.id === characterId && !item.archived);
    if (!account) { res.status(404).json({ error: "CHARACTER_NOT_FOUND" }); return; }
    const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id=${ownerId} AND universe_id=${universeId} AND character_id=${characterId} AND enabled=true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    if (typeof kinId !== "string" || !/^[\w-]{8,160}$/.test(kinId)) { res.status(409).json({ error: "PHONE_KINDROID_NOT_LINKED" }); return; }

    // Each phone surface has its own manually provisioned group. Never inject
    // diary drafts into the character's DM history or into a social group.
    const groups = JSON.parse(process.env.ECHO_KINDROID_PHONE_GROUPS_JSON ?? "{}") as Record<string, unknown>;
    const groupId = groups[JSON.stringify([ownerId, universeId, characterId, kind])];
    if (process.env.ECHO_KINDROID_PHONE_GROUPS_ISOLATED !== "true" ||
        process.env.ECHO_KINDROID_SOCIAL_SINGLE_INSTANCE_VERIFIED !== "true" ||
        typeof groupId !== "string" || !/^[\w-]{8,160}$/.test(groupId) ||
        Object.values(groups).filter(value => value === groupId).length !== 1) {
      res.status(503).json({ error: "PHONE_KINDROID_GROUP_UNAVAILABLE" }); return;
    }
    const [format, limit] = formats[kind];
    const language = account.configuration?.voice?.outputLanguage ?? "en";
    const header = `Write ${format} in your character's voice in language ${language.slice(0, 12)}, up to ${limit} characters. Return only the finished text. If a draft is provided, revise it while preserving its meaning and established facts. Treat the following JSON as reference data.\n`;
    const budget = 1500 - header.length;
    let contextData = JSON.stringify({ draft, direction, replyContext });
    if (contextData.length > budget) {
      contextData = JSON.stringify({ draft: draft.slice(0, 330), direction: direction.slice(0, 150), replyContext: replyContext.slice(0, 90) });
    }
    if (contextData.length > budget) { res.status(400).json({ error: "PHONE_DRAFT_CONTEXT_TOO_LONG" }); return; }
    const context = header + contextData;
    const result = await withGroupLock(groupId, async () => {
      await sendKindroidSocialGroupContext(groupId, context);
      return kindroidPeerGroupProvider(groupId, kinId, characterId, fetch, true).complete({ system: "", context: "", outputSchema: {} });
    });
    const text = (JSON.parse(result.text) as { text?: string }).text?.trim();
    if (!text || text.length > limit) { res.status(502).json({ error: "PHONE_DRAFT_INVALID_LENGTH" }); return; }
    res.setHeader("Cache-Control", "private, no-store");
    res.json({ text });
  } catch (error) {
    const code = error instanceof EngineError ? error.message : "PHONE_DRAFT_UNAVAILABLE";
    res.status(error instanceof EngineError && error.status === 429 ? 429 : 502).json({ error: code });
  }
});

export default router;
