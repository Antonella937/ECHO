import { Router, type IRouter } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { MeteredTextProvider } from "../lib/metered-ai";
import { GeminiDmProvider } from "../ai-engine/gemini";

function parseCommunityDraft(text: string): { comments?: Array<{ handle?: unknown; text?: unknown }> } {
  const trimmed = text.trim();
  try { return JSON.parse(trimmed); } catch { /* The model can add a code fence or extra prose. */ }
  // Find the first complete JSON object, respecting quoted strings and escaped braces.
  for (let start = 0; start < trimmed.length; start++) {
    if (trimmed[start] !== "{") continue;
    let depth = 0;
    let quoted = false;
    let escaped = false;
    for (let i = start; i < trimmed.length; i++) {
      const ch = trimmed[i];
      if (quoted) {
        if (escaped) escaped = false;
        else if (ch === "\\") escaped = true;
        else if (ch === '"') quoted = false;
      } else if (ch === '"') quoted = true;
      else if (ch === "{") depth++;
      else if (ch === "}" && --depth === 0) {
        try {
          const parsed: unknown = JSON.parse(trimmed.slice(start, i + 1));
          if (parsed && typeof parsed === "object" && "comments" in parsed && Array.isArray((parsed as { comments?: unknown }).comments)) {
            return parsed as { comments: Array<{ handle?: unknown; text?: unknown }> };
          }
        } catch { /* Try the next object. */ }
        break;
      }
    }
  }
  throw new Error("COMMUNITY_COMMENT_INVALID_JSON");
}

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
    const communityEligible = account?.communityCommentsEnabled === true || (account?.communityCommentsEnabled !== false && ["band", "business", "venue", "artist"].includes(account?.accountType ?? ""));
    if (!post || !account || post.authorId !== universe?.currentCharacterId || !communityEligible || post.commentsEnabled === false) {
      res.status(403).json({ error: "COMMUNITY_COMMENTS_NOT_ENABLED_OR_NOT_OWNER" }); return;
    }
    const existing = (universe?.comments ?? []).filter(c => c.postId === post.id).slice(-20).map(c => ({ handle: c.guestHandle ?? "character", text: c.text.slice(0, 180) }));
    const provider = new MeteredTextProvider(ownerId, "brain_text", new GeminiDmProvider(undefined, fetch, ownerId));
    const generated = await provider.complete({
      system: "Generate fictional social-network fan comments for an explicitly fictional roleplay world. Output ONLY a JSON object with key comments, an array of objects {handle,text}. Never impersonate real users or celebrities. Handles must be fictional and not match existing real accounts. Keep comments short, varied, natural and contextual. Do not write hateful, sexual, violent, or personally identifying material. Do not create replies or conversations. Do not mention AI. Respect language and vibe of the account. No markdown.",
      context: JSON.stringify({ account: { name: account.name, handle: account.handle, type: account.accountType }, postCaption: (post.caption ?? "").slice(0, 600), existing, count: parsed.data.count }),
      outputSchema: { type: "object", properties: { comments: { type: "array", items: { type: "object", properties: { handle: { type: "string" }, text: { type: "string" } }, required: ["handle", "text"] } } }, required: ["comments"] },
    });
    const raw = parseCommunityDraft(generated.text);
    const used = new Set(existing.map(c => c.text.toLowerCase()));
    const comments = (Array.isArray(raw.comments) ? raw.comments : []).slice(0, parsed.data.count).flatMap(c => {
      const handle = typeof c.handle === "string" ? c.handle.replace(/^@/, "").replace(/[^a-zA-Z0-9._]/g, "").slice(0, 32) : "";
      const text = typeof c.text === "string" ? c.text.trim().slice(0, 280) : "";
      if (handle.length < 3 || !text || used.has(text.toLowerCase())) return [];
      used.add(text.toLowerCase()); return [{ handle, text }];
    });
    res.json({ comments });
  } catch (error) {
    const status = typeof (error as { status?: unknown })?.status === "number" ? (error as { status: number }).status : 503;
    const code = typeof (error as { code?: unknown })?.code === "string" ? (error as { code: string }).code : "COMMUNITY_COMMENT_GENERATION_UNAVAILABLE";
    console.error("[community-comments] draft failed", { code, status, message: error instanceof Error ? error.message : String(error) });
    res.status(status >= 400 && status < 600 ? status : 503).json({ error: code });
  }
});

export default router;
