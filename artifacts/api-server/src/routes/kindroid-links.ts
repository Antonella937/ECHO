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


/** Read-only connection probe. Never sends a message or returns chat content. */
kindroidLinksRouter.get('/characters/kindroid-link/check', async (req,res) => {
  res.setHeader('Cache-Control','private, no-store');
  const p=scope.safeParse(req.query);
  if(!p.success){res.status(400).json({error:'INVALID_QUERY'});return;}
  if(!await authorized(req.userId!,p.data.universeId,p.data.characterId)){
    res.status(403).json({error:'CHARACTER_NOT_ACCESSIBLE'});return;
  }
  try {
    const rows=await db.execute(sql`SELECT kin_id,enabled FROM echo_kindroid_character_links
      WHERE owner_id=${req.userId!} AND universe_id=${p.data.universeId} AND character_id=${p.data.characterId} LIMIT 1`);
    const link=rows.rows[0];
    if(!link || link.enabled!==true){res.status(404).json({error:'KINDROID_LINK_NOT_ENABLED'});return;}
    const key=process.env.ECHO_KINDROID_API_KEY;
    if(!key){res.status(503).json({error:'KINDROID_KEY_MISSING'});return;}
    const url=new URL('https://api.kindroid.ai/v1/get-chat-messages');
    url.searchParams.set('ai_id',String(link.kin_id));
    url.searchParams.set('limit','1');
    const upstream=await fetch(url,{method:'GET',headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)});
    // Never read or return private chat history, even when the request succeeds.
    await upstream.body?.cancel();
    res.json({reachable:upstream.ok,status:upstream.status,category:upstream.ok?'accessible':upstream.status===401||upstream.status===403?'authorization':upstream.status===404?'not_found':upstream.status===400?'bad_request':'upstream_error'});
  }catch{
    res.status(502).json({error:'KINDROID_READ_ONLY_CHECK_FAILED'});
  }
});


/** Owner-only, read-only preflight for retrying an existing DM. Never sends to Kindroid. */
kindroidLinksRouter.get('/characters/kindroid-link/retry-preflight', async (req,res) => {
  res.setHeader('Cache-Control','private, no-store');
  const parsed=scope.extend({messageId:z.string().min(1).max(160)}).safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:'INVALID_QUERY'});return;}
  const {universeId,characterId,messageId}=parsed.data;
  if(!await authorized(req.userId!,universeId,characterId)){
    res.status(403).json({error:'CHARACTER_NOT_ACCESSIBLE'});return;
  }
  try{
    const [universe]=await db.select({state:echoUniversesTable.state}).from(echoUniversesTable)
      .where(and(eq(echoUniversesTable.ownerId,req.userId!),eq(echoUniversesTable.universeId,universeId))).limit(1);
    const state=universe?.state as {messages?:Array<{id:string;senderId:string;recipientId:string;text?:string;threadId?:string}>}|undefined;
    const message=state?.messages?.find(m=>m.id===messageId);
    if(!message || message.recipientId!==characterId || message.senderId===characterId || !message.text?.trim()){
      res.status(404).json({error:'ORIGINAL_DM_NOT_FOUND'});return;
    }
    const link=await db.execute(sql`SELECT enabled FROM echo_kindroid_character_links
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND character_id=${characterId} LIMIT 1`);
    if(link.rows[0]?.enabled!==true){res.status(409).json({error:'KINDROID_LINK_NOT_ENABLED'});return;}
    const hasLaterReply=!!state?.messages?.some(m=>m.threadId===message.threadId && m.senderId===characterId && state.messages!.indexOf(m)>state.messages!.indexOf(message));
    res.json({originalMessageFound:true,kindroidLinkEnabled:true,hasLaterReply,
      safeToSend:false,reason:'UPSTREAM_DELIVERY_NOT_YET_VERIFIED'});
  }catch{res.status(503).json({error:'RETRY_PREFLIGHT_UNAVAILABLE'});}
});

/** Read-only reconciliation: compare the stored DM against recent provider history.
 * Fail closed on unknown response shapes; never expose provider message content. */
kindroidLinksRouter.get('/characters/kindroid-link/retry-history-check', async (req,res) => {
  res.setHeader('Cache-Control','private, no-store');
  const parsed=scope.extend({messageId:z.string().min(1).max(160).optional()}).safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:'INVALID_QUERY'});return;}
  const {universeId,characterId,messageId}=parsed.data;
  if(!await authorized(req.userId!,universeId,characterId)){
    res.status(403).json({error:'CHARACTER_NOT_ACCESSIBLE'});return;
  }
  try{
    const [universe]=await db.select({state:echoUniversesTable.state}).from(echoUniversesTable)
      .where(and(eq(echoUniversesTable.ownerId,req.userId!),eq(echoUniversesTable.universeId,universeId))).limit(1);
    const state=universe?.state as {messages?:Array<{id:string;senderId:string;recipientId:string;text?:string}>}|undefined;
    const original=messageId ? state?.messages?.find(m=>m.id===messageId) : [...(state?.messages??[])].reverse().find(m=>m.recipientId===characterId && m.senderId!==characterId && !!m.text?.trim());
    if(!original?.text?.trim() || original.recipientId!==characterId || original.senderId===characterId){
      res.status(404).json({error:'ORIGINAL_DM_NOT_FOUND'});return;
    }
    const links=await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
      WHERE owner_id=${req.userId!} AND universe_id=${universeId} AND character_id=${characterId} AND enabled=true LIMIT 1`);
    if(!links.rows[0]?.kin_id){res.status(409).json({error:'KINDROID_LINK_NOT_ENABLED'});return;}
    const key=process.env.ECHO_KINDROID_API_KEY;
    if(!key){res.status(503).json({error:'KINDROID_KEY_MISSING'});return;}
    const url=new URL('https://api.kindroid.ai/v1/get-chat-messages');
    url.searchParams.set('ai_id',String(links.rows[0].kin_id));
    url.searchParams.set('limit','100');
    const upstream=await fetch(url,{headers:{Authorization:`Bearer ${key}`},signal:AbortSignal.timeout(12000)});
    if(!upstream.ok){await upstream.body?.cancel();res.status(502).json({error:'KINDROID_HISTORY_UNAVAILABLE',status:upstream.status});return;}
    const body:unknown=await upstream.json();
    const rows=Array.isArray(body)?body:body && typeof body==='object' && !Array.isArray(body)
      ? (body as Record<string,unknown>).messages : undefined;
    if(!Array.isArray(rows)){res.json({historyReadable:true,delivery:'unknown',reason:'UNSUPPORTED_HISTORY_FORMAT',safeToSend:false});return;}
    const texts=rows.map(row=>row && typeof row==='object' && !Array.isArray(row)
      ? (row as Record<string,unknown>).message ?? (row as Record<string,unknown>).content ?? (row as Record<string,unknown>).text
      : undefined).filter((value):value is string=>typeof value==='string');
    const found=texts.some(value=>value.trim()===original.text!.trim());
    // A miss in a bounded history is not proof of non-delivery.
    res.json({historyReadable:true,delivery:found?'found':'unknown',reason:found?'ORIGINAL_TEXT_PRESENT':'NOT_FOUND_IN_RECENT_HISTORY',safeToSend:false});
  }catch{res.status(502).json({error:'KINDROID_HISTORY_CHECK_FAILED'});}
});

/** Disconnect only the external Kindroid adapter. The ECHO character, social
 * state, relationships, messages and memories remain untouched. */
kindroidLinksRouter.delete('/characters/kindroid-link',async(req,res)=>{
  res.setHeader('Cache-Control','private, no-store');
  const p=scope.strict().safeParse(req.body);
  if(!p.success){res.status(400).json({error:'INVALID_QUERY'});return;}
  try{
    if(!await authorized(req.userId!,p.data.universeId,p.data.characterId)){
      res.status(403).json({error:'CHARACTER_NOT_ACCESSIBLE'});return;
    }
    await db.execute(sql`DELETE FROM echo_kindroid_character_links
      WHERE owner_id=${req.userId!} AND universe_id=${p.data.universeId} AND character_id=${p.data.characterId}`);
    res.json({kinId:'',enabled:false,socialContextEnabled:false,disconnected:true});
  }catch{res.status(503).json({error:'KINDROID_DISCONNECT_UNAVAILABLE'});}
});
