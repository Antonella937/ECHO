import { Router, type IRouter } from 'express';
import { and, eq, sql } from 'drizzle-orm';
import { z } from 'zod';
import { db, echoUniversesTable } from '@workspace/db';
import { requireAuth } from '../middlewares/requireAuth';

export const kindroidLinksRouter: IRouter = Router();
kindroidLinksRouter.use('/characters/kindroid-link', requireAuth);
kindroidLinksRouter.get('/characters/kindroid-eligibility', requireAuth, (req,res) => {
  res.setHeader('Cache-Control','private, no-store');
  res.json({ eligible: req.userId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' });
});
const scope = z.object({
  characterId: z.string().min(1).max(120),
  universeId: z.string().min(1).max(120).default('primary'),
});
const payload = scope.extend({
  kinId: z.string().trim().min(8).max(160).regex(/^[A-Za-z0-9_-]+$/),
  enabled: z.boolean(),
  socialContextEnabled: z.boolean().default(false),
}).strict();
async function authorized(ownerId: string, universeId: string, characterId: string) {
  // This rollout intentionally remains restricted to the founder account.
  if (ownerId !== 'user_3LeoBfUicTthDVixNbkPlqXFkdZ') return false;
  const [universe] = await db.select({state:echoUniversesTable.state, archivedAt:echoUniversesTable.archivedAt, deletedAt:echoUniversesTable.deletedAt})
    .from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId,ownerId),eq(echoUniversesTable.universeId,universeId))).limit(1);
  const state = universe?.state as {characters?:Array<{id:string;archived?:boolean}>}|undefined;
  return !!universe && !universe.archivedAt && !universe.deletedAt &&
    !!state?.characters?.some(c=>c.id===characterId && !c.archived);
}
kindroidLinksRouter.get('/characters/kindroid-link',async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  const p=scope.safeParse(req.query);
  if(!p.success){res.status(400).json({error:'INVALID_QUERY'});return;}
  if(!await authorized(req.userId!,p.data.universeId,p.data.characterId)){res.status(403).json({error:'CHARACTER_NOT_ACCESSIBLE'});return;}
  try{
    const rows=await db.execute(sql`SELECT kin_id, enabled, social_context_enabled FROM echo_kindroid_character_links
      WHERE owner_id=${req.userId!} AND universe_id=${p.data.universeId} AND character_id=${p.data.characterId} LIMIT 1`);
    res.json({kinId:rows.rows[0]?.kin_id??'',enabled:rows.rows[0]?.enabled===true,socialContextEnabled:rows.rows[0]?.social_context_enabled===true});
  }catch{res.status(503).json({error:'KINDROID_LINK_UNAVAILABLE'});}
});
kindroidLinksRouter.put('/characters/kindroid-link',async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  const p=payload.safeParse(req.body);
  if(!p.success){res.status(400).json({error:'INVALID_KINDROID_LINK'});return;}
  if(!await authorized(req.userId!,p.data.universeId,p.data.characterId)){res.status(403).json({error:'CHARACTER_NOT_ACCESSIBLE'});return;}
  try{
    // A Kindroid slot is a single external conversation memory. Never enable it
    // for two active ECHO characters, even across separate universes.
    if(p.data.enabled){
      const collisions=await db.execute(sql`SELECT universe_id,character_id FROM echo_kindroid_character_links
        WHERE owner_id=${req.userId!} AND kin_id=${p.data.kinId} AND enabled=true
        AND NOT(universe_id=${p.data.universeId} AND character_id=${p.data.characterId})
        LIMIT 1`);
      if(collisions.rows.length){
        res.status(409).json({error:'KINDROID_SLOT_ALREADY_CONNECTED',universeId:collisions.rows[0].universe_id});
        return;
      }
    }
    await db.execute(sql`INSERT INTO echo_kindroid_character_links (owner_id,universe_id,character_id,kin_id,enabled,social_context_enabled)
      VALUES (${req.userId!},${p.data.universeId},${p.data.characterId},${p.data.kinId},${p.data.enabled},${p.data.socialContextEnabled})
      ON CONFLICT (owner_id,universe_id,character_id)
      DO UPDATE SET kin_id=EXCLUDED.kin_id,enabled=EXCLUDED.enabled,social_context_enabled=EXCLUDED.social_context_enabled,updated_at=now()`);
    res.json({kinId:p.data.kinId,enabled:p.data.enabled,socialContextEnabled:p.data.socialContextEnabled});
  }catch{res.status(503).json({error:'KINDROID_LINK_UNAVAILABLE'});}
});
