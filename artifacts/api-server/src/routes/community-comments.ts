import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { MeteredTextProvider } from "../lib/metered-ai";
import { GeminiDmProvider } from "../ai-engine/gemini";

const router: IRouter = Router();
const input = z.object({
  universeId: z.string().min(1).max(120),
  postId: z.string().min(1).max(160),
  count: z.number().int().min(1).max(6),
}).strict();

router.post("/community-comments/draft", requireAuth, async (req, res) => {
  const parsed = input.safeParse(req.body);
  if (!parsed.success) { res.status(400).json({ error: "INVALID_INPUT" }); return; }
  const ownerId = req.userId!;
  try {
    const { state } = await readUniverse(ownerId, parsed.data.universeId);
    const universe = state as { currentCharacterId?: string; characters?: Array<{ id: string; handle: string; name: string; accountType?: string; communityCommentsEnabled?: boolean }>; posts?: Array<{ id: string; authorId: string; caption?: string; commentsEnabled?: boolean }>; comments?: Array<{ postId: string; guestHandle?: string; text: string }> } | null;
    const post = universe?.posts?.find(p => p.id === parsed.data.postId);
    const account = universe?.characters?.find(c => c.id === post?.authorId);
    if (!post || !account || post.authorId !== universe?.currentCharacterId || !account.communityCommentsEnabled || post.commentsEnabled === false) {
      res.status(403).json({ error: "COMMUNITY_COMMENTS_NOT_ENABLED_OR_NOT_OWNER" }); return;
    }
    const existing = (universe?.comments ?? []).filter(c => c.postId === post.id).slice(-20).map(c => ({ handle: c.guestHandle ?? "character", text: c.text.slice(0, 180) }));
    const provider = new MeteredTextProvider(ownerId, "brain_text", new GeminiDmProvider(undefined, fetch, ownerId));
    const generated = await provider.complete({
      system: "Generate fictional social-network fan comments for an explicitly fictional roleplay world. Output ONLY a JSON object with key comments, an array of objects {handle,text}. Never impersonate real users or celebrities. Handles must be fictional and not match existing real accounts. Keep comments short, varied, natural and contextual. Do not write hateful, sexual, violent, or personally identifying material. Do not create replies or conversations. Do not mention AI. Respect language and vibe of the account. No markdown.",
      context: JSON.stringify({ account: { name: account.name, handle: account.handle, type: account.accountType }, postCaption: (post.caption ?? "").slice(0, 600), existing, count: parsed.data.count }),
      outputSchema: { type: "object", properties: { comments: { type: "array", items: { type: "object", properties: { handle: { type: "string" }, text: { type: "string" } }, required: ["handle", "text"] } } }, required: ["comments"] },
    });
    const raw = JSON.parse(generated.text) as { comments?: Array<{ handle?: unknown; text?: unknown }> };
    const used = new Set(existing.map(c => c.text.toLowerCase()));
    const comments = (Array.isArray(raw.comments) ? raw.comments : []).slice(0, parsed.data.count).flatMap(c => {
      const handle = typeof c.handle === "string" ? c.handle.replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "").slice(0, 32) : "";
      const text = typeof c.text === "string" ? c.text.trim().slice(0, 280) : "";
      if (handle.length < 3 || !text || used.has(text.toLowerCase())) return [];
      used.add(text.toLowerCase()); return [{ handle, text }];
    });
    res.json({ comments });
  } catch {
    res.status(503).json({ error: "COMMUNITY_COMMENT_GENERATION_UNAVAILABLE" });
  }
});

export default router;
