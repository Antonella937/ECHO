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
    const state = universe.state as {characters?:Array<{id:string;archived?:boolean}>;posts?:Array<{id:string;authorId:string}>;stories?:Array<{id:string;authorId:string}>};
    const content = (parsed.data.surface==='post'?state.posts:state.stories)?.find(item=>item.id===parsed.data.contentId);
    if (!content || !state.characters?.some(character=>character.id===content.authorId&&!character.archived)) {
      res.status(404).json({error:'CONTENT_NOT_FOUND'});return;
    }
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
    // Saved thoughts are not a bypass around subsequently revoked access.
    // Re-evaluate each viewer against current follows, blocks, privacy and
    // close-friends membership before exposing historical private text.
    const [acceptedFollows, blocks, authorPrivacy, consentLinks] = await Promise.all([
      readAcceptedCharacterFollows(req.userId!,parsed.data.universeId),
      db.select({
        blockerId:echoCharacterBlocksTable.blockerCharacterId,
        blockedId:echoCharacterBlocksTable.blockedCharacterId,
      }).from(echoCharacterBlocksTable).where(and(
        eq(echoCharacterBlocksTable.blockerOwnerId,req.userId!),
        eq(echoCharacterBlocksTable.blockerUniverseId,parsed.data.universeId),
        eq(echoCharacterBlocksTable.blockedOwnerId,req.userId!),
        eq(echoCharacterBlocksTable.blockedUniverseId,parsed.data.universeId),
      )),
      db.select({visibility:echoCharacterPrivacyTable.visibility})
        .from(echoCharacterPrivacyTable).where(and(
          eq(echoCharacterPrivacyTable.ownerId,req.userId!),
          eq(echoCharacterPrivacyTable.universeId,parsed.data.universeId),
          eq(echoCharacterPrivacyTable.characterId,content.authorId),
        )).limit(1),
      db.execute(sql`SELECT character_id FROM echo_kindroid_character_links
        WHERE owner_id=${req.userId!} AND universe_id=${parsed.data.universeId}
          AND enabled=true AND social_context_enabled=true`),
    ]);
    const activeIds = new Set(state.characters.filter(character=>!character.archived).map(character=>character.id));
    const consentIds = new Set(consentLinks.rows.map(row=>row.character_id));
    const hasFollow = (sourceId:string,targetId:string) => acceptedFollows.some(edge =>
      edge.source.ownerId===req.userId && edge.source.universeId===parsed.data.universeId &&
      edge.source.characterId===sourceId && edge.target.ownerId===req.userId &&
      edge.target.universeId===parsed.data.universeId && edge.target.characterId===targetId);
    res.json({reactions:rows.rows.filter(row=>{
      const viewerId = row.character_id;
      if (typeof viewerId!=='string' || !activeIds.has(viewerId) || !consentIds.has(viewerId) ||
          viewerId===content.authorId || !hasFollow(viewerId,content.authorId)) return false;
      if (authorPrivacy[0]?.visibility==='private' && !hasFollow(content.authorId,viewerId)) return false;
      if (blocks.some(block=>
        (block.blockerId===viewerId && block.blockedId===content.authorId) ||
        (block.blockerId===content.authorId && block.blockedId===viewerId))) return false;
      return parsed.data.surface!=='story' || canCharacterViewCloseFriendsStory(state,content,viewerId);
    })});
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
    const state = universe.state as {characters?:Array<{id:string;archived?:boolean}>;posts?:Array<{id:string;authorId:string;caption?:string;text?:string;content?:string}>;stories?:Array<{id:string;authorId:string;caption?:string;text?:string;content?:string;seenBy?:string[]}>};
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
    // A legacy seenBy array is not an authenticated view receipt. Until the
    // actual story-view persistence is verified, do not claim a real view.
    const viewed = false;
    if (!shouldGenerateInternalReaction({
      characterId,contentId,surface,authorId:content.authorId,
      actuallyViewed:Boolean(viewed),manualInspectionAllowed:true,audienceAllowed:true,
      blocked:false,autonomyEnabled:false,publiclyResponded:false,
    },'manual')) {res.status(403).json({error:'INTERNAL_REACTION_NOT_ALLOWED'});return;}
    const existing = await db.execute(sql`SELECT character_id,reaction_text,mode,actually_viewed,generated_at FROM echo_internal_reactions
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
    // Count in-flight requests as well as saved rows. A creator can inspect
    // multiple characters concurrently, so counting completed rows alone
    // would allow a burst to exceed the daily budget.
    const ownerPendingPrefix = JSON.stringify([req.userId]).slice(0,-1) + ',';
    const otherPending = [...pendingManualReactions].filter(key =>
      key !== pendingKey && key.startsWith(ownerPendingPrefix)).length;
    if (Number(daily.rows[0]?.total ?? 0) + otherPending >= 12) {
      res.status(429).json({error:'INTERNAL_REACTION_DAILY_LIMIT'});return;
    }
    // Opt-in rollout gate: the API must never charge Kindroid merely because
    // the route was deployed. Explicit server configuration is required.
    if (process.env.ECHO_INTERNAL_REACTIONS_GENERATION_ENABLED !== 'true') {
      res.status(503).json({error:'INTERNAL_REACTION_GENERATION_DISABLED'});return;
    }
    // Do not spend a paid generation on an empty caption when no visual
    // description is available to the text-only Kindroid adapter.
    const caption = [content.caption,content.text,content.content].filter((value):value is string=>typeof value==='string').map(value=>value.trim()).find(value=>value.length>0) ?? '';
    if (!caption) {
      res.status(422).json({error:'INTERNAL_REACTION_CONTENT_CONTEXT_MISSING'});return;
    }
    const prompt = internalReactionPrompt(surface,caption,'manual');
    const result = await kindroidDmProvider(prompt,kinId,'',fetch,'internal_reaction').complete({
      system:'Private internal narration only',context:'',outputSchema:{},conversationMode:'narrative',
    });
    const decision = JSON.parse(result.text) as {text?:string};
    const reactionText = decision.text?.trim().slice(0,2000);
    if (!reactionText) {res.status(502).json({error:'EMPTY_INTERNAL_REACTION'});return;}
    // Kindroid can take several seconds. Re-check the current universe before
    // storing a thought about a post/story that may have changed or expired.
    const [latestUniverse] = await db.select({
      state:echoUniversesTable.state,
      archivedAt:echoUniversesTable.archivedAt,
      deletedAt:echoUniversesTable.deletedAt,
    }).from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId,req.userId!),
      eq(echoUniversesTable.universeId,universeId),
    )).limit(1);
    const latestState = latestUniverse?.state as typeof state | undefined;
    const latestContent = (surface==='post'?latestState?.posts:latestState?.stories)?.find(item=>item.id===contentId);
    const latestCaption = latestContent
      ? [latestContent.caption,latestContent.text,latestContent.content]
          .filter((value):value is string=>typeof value==='string')
          .map(value=>value.trim()).find(value=>value.length>0) ?? ''
      : '';
    if (!latestUniverse || latestUniverse.archivedAt || latestUniverse.deletedAt ||
        !latestState?.characters?.some(character=>character.id===characterId&&!character.archived) ||
        !latestState?.characters?.some(character=>character.id===content.authorId&&!character.archived) ||
        !latestContent || latestContent.authorId!==content.authorId || latestCaption!==caption ||
        (surface==='story' && (!storyIsStillVisible(latestState as Record<string,unknown>,
          latestContent as Record<string,unknown>,Date.now()) ||
          !canCharacterViewCloseFriendsStory(latestState,latestContent,characterId)))) {
      res.status(409).json({error:'INTERNAL_REACTION_CONTENT_CHANGED'});return;
    }
    // Access may be revoked while the external model is responding. Do not
    // persist the result if follows, blocks or privacy changed meanwhile.
    const [latestFollows, latestBlocks, latestPrivacy] = await Promise.all([
      readAcceptedCharacterFollows(req.userId!,universeId),
      db.select({
        blockerId:echoCharacterBlocksTable.blockerCharacterId,
        blockedId:echoCharacterBlocksTable.blockedCharacterId,
      }).from(echoCharacterBlocksTable).where(and(
        eq(echoCharacterBlocksTable.blockerOwnerId,req.userId!),
        eq(echoCharacterBlocksTable.blockerUniverseId,universeId),
        eq(echoCharacterBlocksTable.blockedOwnerId,req.userId!),
        eq(echoCharacterBlocksTable.blockedUniverseId,universeId),
      )),
      db.select({visibility:echoCharacterPrivacyTable.visibility})
        .from(echoCharacterPrivacyTable).where(and(
          eq(echoCharacterPrivacyTable.ownerId,req.userId!),
          eq(echoCharacterPrivacyTable.universeId,universeId),
          eq(echoCharacterPrivacyTable.characterId,content.authorId),
        )).limit(1),
    ]);
    const stillFollowsAuthor = latestFollows.some(edge =>
      edge.source.ownerId===req.userId && edge.source.universeId===universeId &&
      edge.source.characterId===characterId && edge.target.ownerId===req.userId &&
      edge.target.universeId===universeId && edge.target.characterId===content.authorId);
    const reciprocalFollow = latestFollows.some(edge =>
      edge.source.ownerId===req.userId && edge.source.universeId===universeId &&
      edge.source.characterId===content.authorId && edge.target.ownerId===req.userId &&
      edge.target.universeId===universeId && edge.target.characterId===characterId);
    const nowBlocked = latestBlocks.some(block =>
      (block.blockerId===characterId && block.blockedId===content.authorId) ||
      (block.blockerId===content.authorId && block.blockedId===characterId));
    if (!stillFollowsAuthor || nowBlocked ||
        (latestPrivacy[0]?.visibility==='private' && !reciprocalFollow)) {
      res.status(409).json({error:'INTERNAL_REACTION_ACCESS_CHANGED'});return;
    }
    // Consent to share character context with Kindroid may be withdrawn while
    // generation is in flight. Never retain the response after opt-out.
    const currentLink = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND character_id=${characterId}
        AND enabled=true AND social_context_enabled=true LIMIT 1`);
    if (currentLink.rows[0]?.kin_id !== kinId) {
      res.status(409).json({error:'KINDROID_SOCIAL_CONTEXT_CONSENT_CHANGED'});return;
    }
    const inserted = await db.execute(sql`INSERT INTO echo_internal_reactions
      (owner_id,universe_id,character_id,surface,content_id,mode,reaction_text,actually_viewed)
      VALUES (${req.userId!},${universeId},${characterId},${surface},${contentId},'manual',${reactionText},${Boolean(viewed)})
      ON CONFLICT DO NOTHING RETURNING character_id,reaction_text,mode,actually_viewed,generated_at`);
    if (inserted.rows.length) {res.status(201).json({reaction:inserted.rows[0],cached:false});return;}
    const winner = await db.execute(sql`SELECT character_id,reaction_text,mode,actually_viewed,generated_at FROM echo_internal_reactions
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
