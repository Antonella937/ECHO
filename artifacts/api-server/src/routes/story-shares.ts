import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq, or } from "drizzle-orm";
import { db, echoCharacterBlocksTable, echoCharacterPrivacyTable, echoUniversesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { canForwardStory } from "../lib/storySharePolicy";
import { storyIsStillVisible } from "../lib/socialContentAccess";

const input = z.object({
  universeId: z.string().min(1).max(120),
  senderId: z.string().min(1).max(120),
  recipientId: z.string().min(1).max(120),
  storyId: z.string().min(1).max(120),
}).strict();

type State = Record<string, unknown>;
const objects = (value: unknown): State[] => Array.isArray(value)
  ? value.filter((v): v is State => v !== null && typeof v === "object" && !Array.isArray(v)) : [];
const followMap = (state: State): Record<string, unknown> =>
  state.follows && typeof state.follows === "object" && !Array.isArray(state.follows)
    ? state.follows as Record<string, unknown> : {};

export function createStorySharesRouter(): IRouter {
  const router: IRouter = Router();
  router.post("/stories/authorize-share", requireAuth, async (req, res): Promise<void> => {
    res.setHeader("Cache-Control", "private, no-store");
    const parsed = input.safeParse(req.body);
    if (!parsed.success) { res.status(400).json({ error: "INVALID_STORY_SHARE" }); return; }
    const { universeId, senderId, recipientId, storyId } = parsed.data;
    try {
      const [universe] = await db.select({ state: echoUniversesTable.state })
        .from(echoUniversesTable).where(and(
          eq(echoUniversesTable.ownerId, req.userId!),
          eq(echoUniversesTable.universeId, universeId),
        )).limit(1);
      if (!universe) { res.status(403).json({ allowed: false }); return; }
      const state = universe.state as State;
      const characters = objects(state.characters);
      const story = objects(state.stories).find(s => s.id === storyId);
      const authorId = typeof story?.authorId === "string" ? story.authorId : "";
      const ids = [senderId, authorId, recipientId];
      if (!story || ids.some(id => !characters.some(c => c.id === id && c.archived !== true)) ||
          !storyIsStillVisible(state, story, Date.now())) {
        res.status(403).json({ allowed: false }); return;
      }
      // A forwarded story must still be active; highlights do not extend share lifetime.
      const created = Date.parse(String(story.createdAt ?? ""));
      const active = Number.isFinite(created) && created <= Date.now() && Date.now() - created < 86400000;
      const follows = followMap(state);
      const acceptedFollows = Object.entries(follows).flatMap(([followerId, targets]) =>
        Array.isArray(targets) ? targets.filter((v): v is string => typeof v === "string")
          .map(followedId => ({ followerId, followedId })) : []);
      const [blocks, privacy] = await Promise.all([
        db.select().from(echoCharacterBlocksTable).where(and(
          eq(echoCharacterBlocksTable.blockerOwnerId, req.userId!),
          eq(echoCharacterBlocksTable.blockerUniverseId, universeId),
        )),
        db.select({ visibility: echoCharacterPrivacyTable.visibility })
          .from(echoCharacterPrivacyTable).where(and(
            eq(echoCharacterPrivacyTable.ownerId, req.userId!),
            eq(echoCharacterPrivacyTable.universeId, universeId),
            eq(echoCharacterPrivacyTable.characterId, authorId),
          )).limit(1),
      ]);
      const closeFriends = (state.closeFriends && typeof state.closeFriends === "object"
        ? state.closeFriends as Record<string, unknown> : {});
      const closeList = Array.isArray(closeFriends[authorId]) ? closeFriends[authorId] as unknown[] : [];
      const allowedIds = Array.isArray(story.allowedViewerIds) ? story.allowedViewerIds : closeList;
      const recipientCanViewStory = !story.closeFriendsOnly ||
        (closeList.includes(recipientId) && allowedIds.includes(recipientId));
      const allowed = canForwardStory({
        senderId, authorId, recipientId, storyActive: active,
        authorVisibility: privacy[0]?.visibility ?? "public",
        recipientCanViewStory, acceptedFollows,
        blocks: blocks.map(b => ({ blockerId: b.blockerCharacterId, blockedId: b.blockedCharacterId })),
        blocksVerified: true,
      });
      res.status(allowed ? 200 : 403).json({ allowed });
    } catch {
      res.status(503).json({ allowed: false, error: "STORY_SHARE_AUTHORIZATION_UNAVAILABLE" });
    }
  });
  return router;
}
export const storySharesRouter = createStorySharesRouter();
