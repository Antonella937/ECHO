import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { SaveUniverseBody } from "@workspace/api-zod";
import { getOwnerPlan } from "../lib/entitlements";

const router: IRouter = Router();
router.use("/voices/premium", requireAuth, (_req,res,next) => {res.setHeader("Cache-Control","private, no-store");next();});
const key = z.object({universeId:z.string().min(1).max(128),characterId:z.string().min(1).max(128)}).strict();
const draft = key.extend({
 mode:z.enum(["prompt","reference"]), prompt:z.string().max(1500).default(""),
 language:z.enum(["en","es","pt","fr","de","it","ko","ja","zh"]),
 variantCount:z.number().int().min(2).max(3),
 consentConfirmed:z.boolean().default(false),
}).strict();
async function checkCharacter(ownerId:string,universeId:string,characterId:string) {
 const snapshot=await readUniverse(ownerId,universeId);
 const parsed=SaveUniverseBody.shape.state.safeParse(snapshot.state);
 return parsed.success && parsed.data.characters.some(c=>c.id===characterId && !c.archived);
}
router.get("/voices/premium/projects",async(req,res)=>{
 const parsed=key.safeParse(req.query);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_PROJECT"});return;}
 try{
  if(!await checkCharacter(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const result=await pool.query(`SELECT id,mode,prompt,language,variant_count AS "variantCount",consent_confirmed AS "consentConfirmed",status,selected_sample_id AS "selectedSampleId"
  FROM echo_voice_projects WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3`,[req.userId,parsed.data.universeId,parsed.data.characterId]);
  const project=result.rows[0]??null;
  const samples=project?(await pool.query(`SELECT id,status,audio_object_path AS "audioObjectPath" FROM echo_voice_samples WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at,id`,[project.id,req.userId])).rows:[];
  res.json({project,samples,generationAvailable:false});
 }catch{res.status(503).json({error:"VOICE_STUDIO_STORAGE_UNAVAILABLE"});}
});
router.put("/voices/premium/projects",async(req,res)=>{
 const parsed=draft.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_PROJECT"});return;}
 const data=parsed.data;
 if(data.mode==="prompt"&&!data.prompt.trim()){res.status(400).json({error:"VOICE_PROMPT_REQUIRED"});return;}
 if(data.mode==="reference"&&!data.consentConfirmed){res.status(400).json({error:"VOICE_CONSENT_REQUIRED"});return;}
 try{
  if(await getOwnerPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,data.universeId,data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const result=await pool.query(`INSERT INTO echo_voice_projects(owner_id,universe_id,character_id,mode,prompt,language,variant_count,consent_confirmed)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(owner_id,universe_id,character_id) DO UPDATE SET mode=EXCLUDED.mode,prompt=EXCLUDED.prompt,language=EXCLUDED.language,
  variant_count=EXCLUDED.variant_count,consent_confirmed=EXCLUDED.consent_confirmed,updated_at=now()
  RETURNING id,status`,[req.userId,data.universeId,data.characterId,data.mode,data.prompt,data.language,data.variantCount,data.consentConfirmed]);
  res.json({project:result.rows[0],generationAvailable:false});
 }catch{res.status(503).json({error:"VOICE_STUDIO_STORAGE_UNAVAILABLE"});}
});
router.post("/voices/premium/generate",requireAuth,(_req,res)=>{
 res.status(503).json({error:"CUSTOM_VOICE_PROVIDER_NOT_CONFIGURED",charged:false});
});
router.post("/voices/premium/select",requireAuth,async(req,res)=>{
 const parsed=z.object({projectId:z.string().uuid(),sampleId:z.string().uuid()}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_SELECTION"});return;}
 try{
  const result=await pool.query(`UPDATE echo_voice_projects p SET selected_sample_id=$3,updated_at=now()
   WHERE p.id=$1 AND p.owner_id=$2 AND EXISTS(SELECT 1 FROM echo_voice_samples s WHERE s.id=$3 AND s.project_id=p.id AND s.owner_id=$2 AND s.status='ready')
   RETURNING p.id,p.selected_sample_id AS "selectedSampleId"`,[parsed.data.projectId,req.userId,parsed.data.sampleId]);
  if(!result.rowCount){res.status(409).json({error:"VOICE_SAMPLE_NOT_READY_OR_NOT_OWNED"});return;}
  res.json({project:result.rows[0]});
 }catch{res.status(503).json({error:"VOICE_STUDIO_STORAGE_UNAVAILABLE"});}
});
export default router;
