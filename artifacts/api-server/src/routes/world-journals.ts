import { Router, type IRouter } from "express";
import { z } from "zod";
import { sql } from "drizzle-orm";
import { db } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";

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
  return r.rows[0] as { state?: { characters?: Array<{id?:string;archived?:boolean}> } } | undefined;
}
function validCharacters(state: { characters?: Array<{id?:string;archived?:boolean}> } | undefined, ids: string[]) {
  const allowed = new Set((state?.characters ?? []).filter(c => !c.archived).map(c => c.id));
  return ids.every(id => allowed.has(id));
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
  if((b.data.knowledgeScope==='selected' && b.data.knownCharacterIds.length===0) ||
     (b.data.knowledgeScope!=='selected' && b.data.knownCharacterIds.length>0) ||
     (b.data.category==='secret' && b.data.knowledgeScope==='everyone')){
    res.status(400).json({error:'INVALID_KNOWLEDGE_SCOPE'});return;
  }
  const e=b.data;
  const r=await db.execute(sql`INSERT INTO echo_world_journals
    (owner_id,universe_id,title,content,category,truth_status,keywords,knowledge_scope,known_character_ids,source_type,created_by,status)
    VALUES (${req.userId!},${p.data.universeId},${e.title},${e.content},${e.category},
    ${e.truthStatus},${sql`ARRAY[${sql.join(e.keywords.map(x=>sql`${x}`),sql`,`)}]::text[]`},
    ${e.knowledgeScope},${sql`ARRAY[${sql.join(e.knownCharacterIds.map(x=>sql`${x}`),sql`,`)}]::text[]`},
    ${e.sourceType},${req.userId!},'draft') RETURNING id,status`);
  res.status(201).json(r.rows[0]);
});
router.put("/universe/:universeId/journals/:journalId",async(req,res):Promise<void>=>{
  const p=invalid(req), b=entrySchema.safeParse(req.body);
  if(!p.success||!b.success||!z.string().uuid().safeParse(req.params.journalId).success){res.status(400).json({error:"INVALID_JOURNAL"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  if(!validCharacters(world.state,b.data.knownCharacterIds)){res.status(400).json({error:"UNKNOWN_CHARACTER"});return;}
  if((b.data.knowledgeScope==='selected' && b.data.knownCharacterIds.length===0) ||
     (b.data.knowledgeScope!=='selected' && b.data.knownCharacterIds.length>0) ||
     (b.data.category==='secret' && b.data.knowledgeScope==='everyone')){
    res.status(400).json({error:'INVALID_KNOWLEDGE_SCOPE'});return;
  }
  const e=b.data;
  const r=await db.execute(sql`UPDATE echo_world_journals SET title=${e.title},content=${e.content},
    category=${e.category},truth_status=${e.truthStatus},
    keywords=${sql`ARRAY[${sql.join(e.keywords.map(x=>sql`${x}`),sql`,`)}]::text[]`},
    knowledge_scope=${e.knowledgeScope},
    known_character_ids=${sql`ARRAY[${sql.join(e.knownCharacterIds.map(x=>sql`${x}`),sql`,`)}]::text[]`},
    status='draft',approved_by=NULL,approved_at=NULL,updated_at=now()
    WHERE id=${req.params.journalId}::uuid AND owner_id=${req.userId!}
    AND universe_id=${p.data.universeId} AND status <> 'archived' RETURNING id,status`);
  if(!r.rows.length){res.status(404).json({error:"JOURNAL_NOT_FOUND"});return;}
  res.json(r.rows[0]);
});
router.post("/universe/:universeId/journals/:journalId/approve",async(req,res):Promise<void>=>{
  const p=invalid(req);
  if(!p.success||!z.string().uuid().safeParse(req.params.journalId).success){res.status(400).json({error:"INVALID_JOURNAL"});return;}
  if(!await ownedWorld(req.userId!,p.data.universeId)){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  const r=await db.execute(sql`UPDATE echo_world_journals SET status='published',
    approved_by=${req.userId!},approved_at=now(),updated_at=now()
    WHERE id=${req.params.journalId}::uuid AND owner_id=${req.userId!}
    AND universe_id=${p.data.universeId} AND status='draft' RETURNING id,status`);
  if(!r.rows.length){res.status(404).json({error:"DRAFT_NOT_FOUND"});return;}
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
// A proposal is only a draft. The AI may suggest text, but never approve or publish it.
router.post("/universe/:universeId/journals/proposals",async(req,res):Promise<void>=>{
  const p=invalid(req);
  const b=entrySchema.safeParse(req.body && typeof req.body==='object' && !Array.isArray(req.body)
    ? {...req.body,sourceType:'ai_suggestion'} : {});
  if(!p.success||!b.success){res.status(400).json({error:"INVALID_PROPOSAL"});return;}
  const world=await ownedWorld(req.userId!,p.data.universeId);
  if(!world){res.status(404).json({error:"UNIVERSE_NOT_FOUND"});return;}
  if(!validCharacters(world.state,b.data.knownCharacterIds)){res.status(400).json({error:"UNKNOWN_CHARACTER"});return;}
  if((b.data.knowledgeScope==='selected' && b.data.knownCharacterIds.length===0) ||
     (b.data.knowledgeScope!=='selected' && b.data.knownCharacterIds.length>0) ||
     (b.data.category==='secret' && b.data.knowledgeScope==='everyone')){
    res.status(400).json({error:'INVALID_KNOWLEDGE_SCOPE'});return;
  }
  const e=b.data;
  const r=await db.execute(sql`INSERT INTO echo_world_journals
    (owner_id,universe_id,title,content,category,truth_status,keywords,knowledge_scope,known_character_ids,source_type,created_by,status)
    VALUES (${req.userId!},${p.data.universeId},${e.title},${e.content},${e.category},
    ${e.truthStatus},${sql`ARRAY[${sql.join(e.keywords.map(x=>sql`${x}`),sql`,`)}]::text[]`},
    ${e.knowledgeScope},${sql`ARRAY[${sql.join(e.knownCharacterIds.map(x=>sql`${x}`),sql`,`)}]::text[]`},
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
