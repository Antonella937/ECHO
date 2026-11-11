import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { and, eq, sql } from 'drizzle-orm';
import { db, echoUniversesTable, echoCharacterBlocksTable, echoCharacterPrivacyTable } from '@workspace/db';
import { canCharacterViewCloseFriendsStory } from '../lib/storySharePolicy';
import { storyIsStillVisible, readAcceptedCharacterFollows } from '../lib/socialContentAccess';
import { kindroidDmProvider } from '../ai-engine/kindroid';
import { internalReactionPrompt, shouldGenerateInternalReaction } from '../autonomy/internal-reactions';
import { requireAuth } from '../middlewares/requireAuth';

/**
 * Private creator inspection only. No public social API exposes these thoughts.
 * Manual generation is founder-only and requires explicit Kindroid social-context opt-in.
 */
export const internalReactionsRouter: IRouter = Router();
const query = z.object({
  universeId: z.string().min(1).max(120).default('primary'),
  surface: z.enum(['post','story']),
  contentId: z.string().min(1).max(255),
}).strict();

internalReactionsRouter.get('/internal-reactions', requireAuth, async (req,res): Promise<void> => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.userId !== 'user_3LeoBfUicTthDVixNbkPlqXFkdZ') {
    res.status(403).json({error:'INTERNAL_REACTIONS_NOT_AVAILABLE'}); return;
  }
  const parsed = query.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({error:'INVALID_INTERNAL_REACTIONS_QUERY'}); return; }
  try {
    const [universe] = await db.select({state:echoUniversesTable.state,archivedAt:echoUniversesTable.archivedAt,deletedAt:echoUniversesTable.deletedAt})
      .from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId,req.userId!),eq(echoUniversesTable.universeId,parsed.data.universeId))).limit(1);
    if (!universe || universe.archivedAt || universe.deletedAt) {res.status(404).json({error:'UNIVERSE_NOT_FOUND'});return;}
    const state = universe.state as {posts?:Array<{id:string}>;stories?:Array<{id:string}>};
    const content = (parsed.data.surface==='post'?state.posts:state.stories)?.find(item=>item.id===parsed.data.contentId);
    if (!content) {res.status(404).json({error:'CONTENT_NOT_FOUND'});return;}
    if (parsed.data.surface==='story' && !storyIsStillVisible(state as Record<string,unknown>,content as Record<string,unknown>,Date.now())) {
      res.status(404).json({error:'CONTENT_NOT_FOUND'});return;
    }
    const rows = await db.execute(sql`
      SELECT character_id, surface, content_id, mode, reaction_text, actually_viewed, generated_at
      FROM echo_internal_reactions
      WHERE owner_id = ${req.userId!}
        AND universe_id = ${parsed.data.universeId}
        AND surface = ${parsed.data.surface}
        AND content_id = ${parsed.data.contentId}
      ORDER BY generated_at DESC LIMIT 50
    `);
    res.json({reactions:rows.rows});
  } catch {
    res.status(503).json({error:'INTERNAL_REACTIONS_UNAVAILABLE'});
  }
});

const manualPayload = query.extend({characterId:z.string().min(1).max(120)}).strict();
// Process-local guard: repeated taps must not trigger duplicate paid calls.
// A distributed reservation is still required before multi-instance rollout.
const pendingManualReactions = new Set<string>();

/** Explicit creator request. Does not create a view receipt, comment, like or DM. */
internalReactionsRouter.post('/internal-reactions/manual', requireAuth, async (req,res): Promise<void> => {
  res.setHeader('Cache-Control','private, no-store');
  if (req.userId !== 'user_3LeoBfUicTthDVixNbkPlqXFkdZ') {
    res.status(403).json({error:'INTERNAL_REACTIONS_NOT_AVAILABLE'}); return;
  }
  const parsed = manualPayload.safeParse(req.body);
  if (!parsed.success) {res.status(400).json({error:'INVALID_INTERNAL_REACTION_REQUEST'});return;}
  const {universeId,surface,contentId,characterId} = parsed.data;
  const pendingKey = JSON.stringify([req.userId,universeId,surface,contentId,characterId]);
  if (pendingManualReactions.has(pendingKey)) {
    res.status(409).json({error:'INTERNAL_REACTION_ALREADY_GENERATING'});return;
  }
  pendingManualReactions.add(pendingKey);
  try {
    const [universe] = await db.select({state:echoUniversesTable.state,archivedAt:echoUniversesTable.archivedAt,deletedAt:echoUniversesTable.deletedAt})
      .from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId,req.userId!),eq(echoUniversesTable.universeId,universeId))).limit(1);
    if (!universe || universe.archivedAt || universe.deletedAt) {res.status(404).json({error:'UNIVERSE_NOT_FOUND'});return;}
    const state = universe.state as {characters?:Array<{id:string;archived?:boolean}>;posts?:Array<{id:string;authorId:string;caption?:string}>;stories?:Array<{id:string;authorId:string;caption?:string;seenBy?:string[]}>};
    if (!state.characters?.some(c=>c.id===characterId&&!c.archived)) {res.status(404).json({error:'CHARACTER_NOT_FOUND'});return;}
    const content = (surface==='post'?state.posts:state.stories)?.find(c=>c.id===contentId);
    if (!content || content.authorId===characterId) {res.status(404).json({error:'CONTENT_NOT_FOUND'});return;}
    // Conservative initial rollout: only creator-owned content; never leak other
    // users' private posts/stories into a linked external provider.
    if (!state.characters.some(c=>c.id===content.authorId&&!c.archived)) {res.status(403).json({error:'CONTENT_ACCESS_UNVERIFIED'});return;}
    // Only characters who follow the author can inspect their content.
    const acceptedFollows = await readAcceptedCharacterFollows(req.userId!,universeId);
    const followsAuthor = acceptedFollows.some(edge =>
      edge.source.ownerId===req.userId && edge.source.universeId===universeId &&
      edge.source.characterId===characterId && edge.target.ownerId===req.userId &&
      edge.target.universeId===universeId && edge.target.characterId===content.authorId);
    if (!followsAuthor) {res.status(403).json({error:'CHARACTER_CANNOT_VIEW_AUTHOR'});return;}
    // A follow does not override a block in either direction.
    const blocks = await db.select({
      blockerId:echoCharacterBlocksTable.blockerCharacterId,
      blockedId:echoCharacterBlocksTable.blockedCharacterId,
    }).from(echoCharacterBlocksTable).where(and(
      eq(echoCharacterBlocksTable.blockerOwnerId,req.userId!),
      eq(echoCharacterBlocksTable.blockerUniverseId,universeId),
      eq(echoCharacterBlocksTable.blockedOwnerId,req.userId!),
      eq(echoCharacterBlocksTable.blockedUniverseId,universeId),
    ));
    if (blocks.some(block =>
      (block.blockerId===characterId && block.blockedId===content.authorId) ||
      (block.blockerId===content.authorId && block.blockedId===characterId))) {
      res.status(403).json({error:'CHARACTERS_BLOCKED'});return;
    }
    // A private author requires a reciprocal accepted follow.
    const [privacy] = await db.select({visibility:echoCharacterPrivacyTable.visibility})
      .from(echoCharacterPrivacyTable).where(and(
        eq(echoCharacterPrivacyTable.ownerId,req.userId!),
        eq(echoCharacterPrivacyTable.universeId,universeId),
        eq(echoCharacterPrivacyTable.characterId,content.authorId),
      )).limit(1);
    if (privacy?.visibility==='private' && !acceptedFollows.some(edge =>
      edge.source.ownerId===req.userId && edge.source.universeId===universeId &&
      edge.source.characterId===content.authorId && edge.target.ownerId===req.userId &&
      edge.target.universeId===universeId && edge.target.characterId===characterId)) {
      res.status(403).json({error:'PRIVATE_AUTHOR_ACCESS_DENIED'});return;
    }
    // Do not let a manual request bypass close-friends or story expiry.
    if (surface==='story' && (!canCharacterViewCloseFriendsStory(state,content,characterId) ||
        !storyIsStillVisible(state as Record<string,unknown>,content as Record<string,unknown>,Date.now()))) {
      res.status(403).json({error:'STORY_NOT_VISIBLE_TO_CHARACTER'});return;
    }
    const viewed = surface==='story' && 'seenBy' in content && Array.isArray(content.seenBy) && content.seenBy.includes(characterId);
    if (!shouldGenerateInternalReaction({
      characterId,contentId,surface,authorId:content.authorId,
      actuallyViewed:Boolean(viewed),manualInspectionAllowed:true,audienceAllowed:true,
      blocked:false,autonomyEnabled:false,publiclyResponded:false,
    },'manual')) {res.status(403).json({error:'INTERNAL_REACTION_NOT_ALLOWED'});return;}
    const existing = await db.execute(sql`SELECT reaction_text,mode,actually_viewed,generated_at FROM echo_internal_reactions
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND character_id=${characterId}
        AND surface=${surface} AND content_id=${contentId} LIMIT 1`);
    if (existing.rows.length) {res.json({reaction:existing.rows[0],cached:true});return;}
    const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND character_id=${characterId}
        AND enabled=true AND social_context_enabled=true LIMIT 1`);
    const kinId = links.rows[0]?.kin_id;
    if (typeof kinId!=='string') {res.status(409).json({error:'KINDROID_SOCIAL_CONTEXT_NOT_ENABLED'});return;}
    // Budget guard: limit new manual generations to 12 per owner per UTC day.
    // Cached reads above never consume this allowance.
    const daily = await db.execute(sql`SELECT count(*)::int AS total
      FROM echo_internal_reactions
      WHERE owner_id=${req.userId!} AND mode='manual'
        AND generated_at >= date_trunc('day',now() AT TIME ZONE 'UTC') AT TIME ZONE 'UTC'`);
    if (Number(daily.rows[0]?.total ?? 0) >= 12) {
      res.status(429).json({error:'INTERNAL_REACTION_DAILY_LIMIT'});return;
    }
    const prompt = internalReactionPrompt(surface,content.caption??'','manual');
    const result = await kindroidDmProvider(prompt,kinId,'',fetch,'internal_reaction').complete({
      system:'Private internal narration only',context:'',outputSchema:{},conversationMode:'narrative',
    });
    const decision = JSON.parse(result.text) as {text?:string};
    const reactionText = decision.text?.trim().slice(0,2000);
    if (!reactionText) {res.status(502).json({error:'EMPTY_INTERNAL_REACTION'});return;}
    const inserted = await db.execute(sql`INSERT INTO echo_internal_reactions
      (owner_id,universe_id,character_id,surface,content_id,mode,reaction_text,actually_viewed)
      VALUES (${req.userId!},${universeId},${characterId},${surface},${contentId},'manual',${reactionText},${Boolean(viewed)})
      ON CONFLICT DO NOTHING RETURNING reaction_text,mode,actually_viewed,generated_at`);
    if (inserted.rows.length) {res.status(201).json({reaction:inserted.rows[0],cached:false});return;}
    const winner = await db.execute(sql`SELECT reaction_text,mode,actually_viewed,generated_at FROM echo_internal_reactions
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND character_id=${characterId}
      AND surface=${surface} AND content_id=${contentId} LIMIT 1`);
    res.json({reaction:winner.rows[0],cached:true});
  } catch (error) {
    const status = typeof error==='object' && error!==null && 'status' in error && typeof error.status==='number' ? error.status : 503;
    res.status(status>=400&&status<=599?status:503).json({error:'INTERNAL_REACTION_GENERATION_UNAVAILABLE'});
  } finally {
    pendingManualReactions.delete(pendingKey);
  }
});
