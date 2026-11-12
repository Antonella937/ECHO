import { Router, type IRouter } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { validJournalAudience } from "../lib/worldJournalAudience";
import { suggestWorldJournal } from "../lib/worldJournalProposal";

const router: IRouter = Router();
router.use("/universe/:universeId/journals", requireAuth);
const params = z.object({ universeId: z.string().min(1).max(100) });
const entrySchema = z.object({
  title: z.string().trim().min(1).max(180),
  content: z.string().trim().min(1).max(20000),
  category: z.enum(["world_knowledge", "shared_memory", "secret"]),
  truthStatus: z.enum(["confirmed", "rumor", "belief", "unknown"]).default("unknown"),
  keywords: z.array(z.string().trim().min(1).max(80)).max(30).default([]),
  knowledgeScope: z.enum(["everyone", "selected", "nobody"]).default("selected"),
  knownCharacterIds: z.array(z.string().min(1).max(120)).max(100).default([]),
  sourceType: z.enum(["manual", "ai_suggestion", "conversation"]).default("manual"),
}).strict();

async function ownedWorld(ownerId: string, universeId: string) {
  const r = await db.execute(sql`SELECT state FROM echo_universes
    WHERE owner_id=${ownerId} AND universe_id=${universeId}
    AND archived_at IS NULL AND deleted_at IS NULL LIMIT 1`);
  const row = r.rows[0] as { state?: unknown } | undefined;
  if (!row || !row.state || typeof row.state !== 'object' || Array.isArray(row.state)) return undefined;
  const state = row.state as { characters?: unknown };
  if (!Array.isArray(state.characters) || !state.characters.every(c =>
    c !== null && typeof c === 'object' && !Array.isArray(c)
    && typeof (c as {id?:unknown}).id === 'string'
    && (c as {id:string}).id.length > 0
    && ((c as {archived?:unknown}).archived === undefined || typeof (c as {archived?:unknown}).archived === 'boolean'))) return undefined;
  return row as { state: { characters: Array<{id?:string;archived?:boolean}> } };
}
function validAudience(state: { characters?: Array<{id?:string;archived?:boolean}> } | undefined,
  entry: z.infer<typeof entrySchema>) {
  return validJournalAudience(entry, (state?.characters ?? [])
    .filter(c => !c.archived && typeof c.id === 'string').map(c => c.id!));
}
function validCharacters(state: { characters?: Array<{id?:string;archived?:boolean}> } | undefined, ids: string[]) {
  const allowed = new Set((state?.characters ?? []).filter(c => !c.archived).map(c => c.id));
  return ids.length === new Set(ids).size && ids.every(id => allowed.has(id));
}
/** Empty arrays must not reach sql.join([]), which throws before SQL is sent. */
function textArray(items: readonly string[]) {
  return items.length
    ? sql`ARRAY[${sql.join(items.map(item => sql`${item}`), sql`,`)}]::text[]`
    : sql`ARRAY[]::text[]`;
}
function invalid(req: {params:unknown}) { return params.safeParse(req.params); }
router.get("/universe/:universeId/journals", async (req,res):Promise<void> => {
  const p=invalid(req); if(!p.success){res.status(400).json({error:"INVALID_UNIVERSE_ID"});return;}
  if(!await ownedWorld(req.userId!,p.data.universeId)){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  const r=await db.execute(sql`SELECT id,title,content,category,truth_status,keywords,knowledge_scope,
    known_character_ids,status,source_type,created_at,updated_at FROM echo_world_journals
    WHERE owner_id=${req.userId!} AND universe_id=${p.data.universeId}
    ORDER BY created_at DESC LIMIT 500`);
  res.setHeader("Cache-Control","private, no-store");res.json({entries:r.rows});
});
router.post("/universe/:universeId/journals", async(req,res):Promise<void>=>{
  const p=invalid(req), b=entrySchema.safeParse(req.body);
  if(!p.success||!b.success){res.status(400).json({error:"INVALID_JOURNAL"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  if(!validCharacters(world.state,b.data.knownCharacterIds)){res.status(400).json({error:"UNKNOWN_CHARACTER"});return;}
  if(!validAudience(world.state,b.data)){
    res.status(400).json({error:'INVALID_KNOWLEDGE_SCOPE'});return;
  }
  const e=b.data;
  const r=await db.execute(sql`INSERT INTO echo_world_journals
    (owner_id,universe_id,title,content,category,truth_status,keywords,knowledge_scope,known_character_ids,source_type,created_by,status)
    VALUES (${req.userId!},${p.data.universeId},${e.title},${e.content},${e.category},
    ${e.truthStatus},${textArray(e.keywords)},
    ${e.knowledgeScope},${textArray(e.knownCharacterIds)},
    ${e.sourceType},${req.userId!},'draft') RETURNING id,status`);
  res.status(201).json(r.rows[0]);
});
router.put("/universe/:universeId/journals/:journalId",async(req,res):Promise<void>=>{
  const p=invalid(req), b=entrySchema.safeParse(req.body);
  if(!p.success||!b.success||!z.string().uuid().safeParse(req.params.journalId).success){res.status(400).json({error:"INVALID_JOURNAL"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  if(!validCharacters(world.state,b.data.knownCharacterIds)){res.status(400).json({error:"UNKNOWN_CHARACTER"});return;}
  if(!validAudience(world.state,b.data)){
    res.status(400).json({error:'INVALID_KNOWLEDGE_SCOPE'});return;
  }
  const e=b.data;
  const r=await db.execute(sql`UPDATE echo_world_journals SET title=${e.title},content=${e.content},
    category=${e.category},truth_status=${e.truthStatus},
    keywords=${textArray(e.keywords)},
    knowledge_scope=${e.knowledgeScope},
    known_character_ids=${textArray(e.knownCharacterIds)},
    source_type=${e.sourceType},
    status='draft',approved_by=NULL,approved_at=NULL,updated_at=now()
    WHERE id=${req.params.journalId}::uuid AND owner_id=${req.userId!}
    AND universe_id=${p.data.universeId} AND status <> 'archived' RETURNING id,status`);
  if(!r.rows.length){res.status(404).json({error:"JOURNAL_NOT_FOUND"});return;}
  res.json(r.rows[0]);
});
router.post("/universe/:universeId/journals/:journalId/approve",async(req,res):Promise<void>=>{
  const p=invalid(req);
  if(!p.success||!z.string().uuid().safeParse(req.params.journalId).success){res.status(400).json({error:"INVALID_JOURNAL"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  const draft=await db.execute(sql`SELECT category,knowledge_scope,known_character_ids,updated_at
    FROM echo_world_journals WHERE id=${req.params.journalId}::uuid
    AND owner_id=${req.userId!} AND universe_id=${p.data.universeId}
    AND status='draft' LIMIT 1`);
  if(!draft.rows.length){res.status(404).json({error:"DRAFT_NOT_FOUND"});return;}
  const audience=draft.rows[0] as {category:unknown;knowledge_scope:unknown;known_character_ids:unknown;updated_at:unknown};
  const ids=audience.known_character_ids;
  const category=audience.category;
  const scope=audience.knowledge_scope;
  if(!Array.isArray(ids) || !ids.every((id):id is string=>typeof id==='string')
    || !['world_knowledge','shared_memory','secret'].includes(String(category))
    || !['everyone','selected','nobody'].includes(String(scope))
    || !validCharacters(world.state,ids)
    || !validJournalAudience({
      category:category as 'world_knowledge'|'shared_memory'|'secret',
      knowledgeScope:scope as 'everyone'|'selected'|'nobody',
      knownCharacterIds:ids
    },world.state.characters.filter(ch=>!ch.archived).map(ch=>ch.id!))){
    res.status(409).json({error:"JOURNAL_AUDIENCE_CHANGED"});return;
  }
  const r=await db.execute(sql`UPDATE echo_world_journals SET status='published',
    approved_by=${req.userId!},approved_at=now(),updated_at=now()
    WHERE id=${req.params.journalId}::uuid AND owner_id=${req.userId!}
    AND universe_id=${p.data.universeId} AND status='draft'
    AND category=${category as string} AND knowledge_scope=${scope as string}
    AND known_character_ids=${textArray(ids)}
    AND updated_at=${audience.updated_at as Date} RETURNING id,status`);
  if(!r.rows.length){res.status(409).json({error:"JOURNAL_CHANGED_RETRY"});return;}
  res.json(r.rows[0]);
});
router.post("/universe/:universeId/journals/:journalId/archive",async(req,res):Promise<void>=>{
  const p=invalid(req);
  if(!p.success||!z.string().uuid().safeParse(req.params.journalId).success){res.status(400).json({error:"INVALID_JOURNAL"});return;}
  if(!await ownedWorld(req.userId!,p.data.universeId)){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  const r=await db.execute(sql`UPDATE echo_world_journals SET status='archived',
    updated_at=now() WHERE id=${req.params.journalId}::uuid AND owner_id=${req.userId!}
    AND universe_id=${p.data.universeId} RETURNING id,status`);
  if(!r.rows.length){res.status(404).json({error:"JOURNAL_NOT_FOUND"});return;}
  res.json(r.rows[0]);
});
// Extract from persisted conversations, never from arbitrary client-supplied history.
// This is owner-triggered and read-only; the proposal remains unapproved.
router.post("/universe/:universeId/journals/suggest-from-conversation",async(req,res):Promise<void>=>{
  const p=invalid(req);
  const b=z.object({characterId:z.string().min(1).max(120),recipientId:z.string().min(1).max(120)}).strict().safeParse(req.body);
  if(!p.success||!b.success){res.status(400).json({error:"INVALID_CONVERSATION_REQUEST"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  if(!validCharacters(world.state,[b.data.characterId,b.data.recipientId])){
    res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;
  }
  const state=world.state as {characters:Array<{id?:string;archived?:boolean}>;messages?:unknown};
  if(!Array.isArray(state.messages)){res.status(422).json({error:"CONVERSATION_UNAVAILABLE"});return;}
  const messages=state.messages.filter((m):m is {senderId:string;recipientId:string;text:string;threadId:string;hiddenForIds?:string[]}=>{
    if(!m||typeof m!=='object')return false;
    const v=m as Record<string,unknown>;
    return typeof v.senderId==='string'&&typeof v.recipientId==='string'&&typeof v.threadId==='string'&&typeof v.text==='string'&&
      (!Array.isArray(v.hiddenForIds)||!v.hiddenForIds.includes(b.data.characterId))&&
      (!Array.isArray(v.hiddenForIds)||!v.hiddenForIds.includes(b.data.recipientId))&&
      ((v.senderId===b.data.characterId&&v.recipientId===b.data.recipientId)||
       (v.senderId===b.data.recipientId&&v.recipientId===b.data.characterId));
  });
  // Select the most recent matching thread before limiting history; otherwise
  // messages from other threads could crowd out the relevant conversation.
  const latestThread=messages[messages.length-1]?.threadId;
  const sameThread=messages.filter(m=>m.threadId===latestThread).slice(-30);
  if(sameThread.length<2){res.status(422).json({error:"NOT_ENOUGH_CONVERSATION"});return;}
  const excerpt=sameThread.map(m=>`${m.senderId}: ${m.text.slice(0,500)}`).join('\n').slice(-6000);
  try{
    const characters=world.state.characters.filter(ch=>!ch.archived&&ch.id).map(ch=>({id:ch.id!,name:ch.id!}));
    const candidate=await suggestWorldJournal(excerpt,characters);
    res.setHeader("Cache-Control","private, no-store");
    res.json({candidate});
  }catch{res.status(503).json({error:"JOURNAL_SUGGESTION_UNAVAILABLE"});}
});
// Generate at most one private, unapproved suggestion from a recent DM thread.
// The owner opts in to this lightweight check; repeated checks do not spend model
// credits when the conversation has not changed.
router.post("/universe/:universeId/journals/check-conversation",async(req,res):Promise<void>=>{
  const p=invalid(req);
  const b=z.object({threadId:z.string().min(1).max(120)}).strict().safeParse(req.body);
  if(!p.success||!b.success){res.status(400).json({error:"INVALID_CONVERSATION_REQUEST"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  const state=world.state as {characters:Array<{id?:string;name?:string;archived?:boolean}>;messages?:unknown};
  if(!Array.isArray(state.messages)){res.status(422).json({error:"CONVERSATION_UNAVAILABLE"});return;}
  const active=new Set(state.characters.filter(ch=>!ch.archived).map(ch=>ch.id));
  const thread=state.messages.filter((m):m is {id:string;threadId:string;senderId:string;recipientId:string;text:string}=>{
    if(!m||typeof m!=='object')return false;
    const v=m as Record<string,unknown>;
    return v.threadId===b.data.threadId&&typeof v.id==='string'&&typeof v.senderId==='string'&&
      typeof v.recipientId==='string'&&typeof v.text==='string'&&
      active.has(v.senderId)&&active.has(v.recipientId)&&
      (!Array.isArray(v.hiddenForIds)||v.hiddenForIds.length===0);
  }).slice(-20);
  const last=thread[thread.length-1];
  if(thread.length<4||!last){res.json({created:false,reason:"NOT_ENOUGH_CONVERSATION"});return;}
  const marker='dm:'+b.data.threadId+':'+last.id;
  // Limit model calls per thread even when many new messages arrive.
  const existing=await db.execute(sql`SELECT id FROM echo_world_journals WHERE owner_id=${req.userId!}
    AND universe_id=${p.data.universeId}
    AND (source_reference=${marker} OR
      (source_reference LIKE ${'dm:'+b.data.threadId+':%'} AND created_at > now() - interval '6 hours'))
    LIMIT 1`);
  if(existing.rows.length){res.json({created:false,reason:"RECENT_PROPOSAL"});return;}
  const excerpt=thread.map(m=>`${m.senderId}: ${m.text.slice(0,300)}`).join('\n').slice(-6000);
  try {
    const characters=state.characters.filter(ch=>!ch.archived&&ch.id).map(ch=>({id:ch.id!,name:ch.name||ch.id!}));
    const candidate=await suggestWorldJournal(excerpt,characters);
    if(!candidate){res.json({created:false,reason:"NO_DURABLE_FACT"});return;}
    // Never let AI publish or grant general visibility without owner approval.
    const r=await db.execute(sql`INSERT INTO echo_world_journals
      (owner_id,universe_id,title,content,category,truth_status,keywords,knowledge_scope,
       known_character_ids,source_type,source_reference,created_by,status)
      VALUES (${req.userId!},${p.data.universeId},${candidate.title},${candidate.content},
       ${candidate.category},${candidate.truthStatus},${textArray(candidate.keywords)},
       'nobody',ARRAY[]::text[],'ai_suggestion',${marker},${req.userId!},'draft')
      RETURNING id`);
    res.status(201).json({created:true,id:r.rows[0]?.id});
  } catch {res.status(503).json({error:"JOURNAL_SUGGESTION_UNAVAILABLE"});}
});
// Owner-triggered extraction uses free models and never persists or publishes by itself.
router.post("/universe/:universeId/journals/suggest",async(req,res):Promise<void>=>{
  const p=invalid(req);
  const body=z.object({excerpt:z.string().trim().min(20).max(6000)}).strict().safeParse(req.body);
  if(!p.success||!body.success){res.status(400).json({error:"INVALID_EXCERPT"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  const characters=world.state.characters.filter(c=>!c.archived && c.id).map(c=>({id:c.id!,name:c.id!}));
  try{
    const candidate=await suggestWorldJournal(body.data.excerpt,characters);
    res.setHeader("Cache-Control","private, no-store");
    res.json({candidate});
  }catch{
    res.status(503).json({error:"JOURNAL_SUGGESTION_UNAVAILABLE"});
  }
});
// A proposal is only a draft. The AI may suggest text, but never approve or publish it.
router.post("/universe/:universeId/journals/proposals",async(req,res):Promise<void>=>{
  const p=invalid(req);
  const b=entrySchema.safeParse(req.body && typeof req.body==='object' && !Array.isArray(req.body)
    ? {...req.body,sourceType:'ai_suggestion'} : {});
  if(!p.success||!b.success){res.status(400).json({error:"INVALID_PROPOSAL"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  if(!validCharacters(world.state,b.data.knownCharacterIds)){res.status(400).json({error:"UNKNOWN_CHARACTER"});return;}
  if(!validAudience(world.state,b.data)){
    res.status(400).json({error:'INVALID_KNOWLEDGE_SCOPE'});return;
  }
  const e=b.data;
  const r=await db.execute(sql`INSERT INTO echo_world_journals
    (owner_id,universe_id,title,content,category,truth_status,keywords,knowledge_scope,known_character_ids,source_type,created_by,status)
    VALUES (${req.userId!},${p.data.universeId},${e.title},${e.content},${e.category},
    ${e.truthStatus},${textArray(e.keywords)},
    ${e.knowledgeScope},${textArray(e.knownCharacterIds)},
    'ai_suggestion',${req.userId!},'draft') RETURNING id,status`);
  res.status(201).json(r.rows[0]);
});
router.get("/universe/:universeId/journals/knowledge/:characterId",async(req,res):Promise<void>=>{
  const p=invalid(req), characterId=req.params.characterId;
  if(!p.success||!characterId||characterId.length>120){res.status(400).json({error:"INVALID_REQUEST"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world||!validCharacters(world.state,[characterId])){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const r=await db.execute(sql`SELECT id,title,content,truth_status,keywords FROM echo_world_journals
    WHERE owner_id=${req.userId!} AND universe_id=${p.data.universeId}
    AND status='published' AND ((knowledge_scope='everyone' AND category <> 'secret')
      OR (knowledge_scope='selected' AND ${characterId}=ANY(known_character_ids)))
    ORDER BY updated_at DESC LIMIT 100`);
  res.setHeader("Cache-Control","private, no-store");res.json({entries:r.rows});
});
export default router;
