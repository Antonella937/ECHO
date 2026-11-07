import { Router, type IRouter } from "express";
import { z } from "zod";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { SaveUniverseBody } from "@workspace/api-zod";
import { resolveEchoPlan } from "../lib/entitlements";
import { elevenLabsVoiceStatus } from "../lib/elevenLabsVoice";

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
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const result=await pool.query(`SELECT id,mode,prompt,language,variant_count AS "variantCount",consent_confirmed AS "consentConfirmed",status,selected_sample_id AS "selectedSampleId"
  FROM echo_voice_projects WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3`,[req.userId,parsed.data.universeId,parsed.data.characterId]);
  const project=result.rows[0]??null;
  const samples=project?(await pool.query(`SELECT id,status,audio_object_path AS "audioObjectPath" FROM echo_voice_samples WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at,id`,[project.id,req.userId])).rows:[];
  res.json({project,samples,generationAvailable:elevenLabsVoiceStatus().generationAvailable,provider:elevenLabsVoiceStatus().provider});
 }catch{res.status(503).json({error:"VOICE_STUDIO_STORAGE_UNAVAILABLE"});}
});
router.put("/voices/premium/projects",async(req,res)=>{
 const parsed=draft.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_PROJECT"});return;}
 const data=parsed.data;
 if(data.mode==="prompt"&&!data.prompt.trim()){res.status(400).json({error:"VOICE_PROMPT_REQUIRED"});return;}
 if(data.mode==="reference"&&!data.consentConfirmed){res.status(400).json({error:"VOICE_CONSENT_REQUIRED"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,data.universeId,data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const result=await pool.query(`INSERT INTO echo_voice_projects(owner_id,universe_id,character_id,mode,prompt,language,variant_count,consent_confirmed)
  VALUES($1,$2,$3,$4,$5,$6,$7,$8)
  ON CONFLICT(owner_id,universe_id,character_id) DO UPDATE SET mode=EXCLUDED.mode,prompt=EXCLUDED.prompt,language=EXCLUDED.language,
  variant_count=EXCLUDED.variant_count,consent_confirmed=EXCLUDED.consent_confirmed,updated_at=now()
  RETURNING id,status`,[req.userId,data.universeId,data.characterId,data.mode,data.prompt,data.language,data.variantCount,data.consentConfirmed]);
  res.json({project:result.rows[0],generationAvailable:elevenLabsVoiceStatus().generationAvailable});
 }catch{res.status(503).json({error:"VOICE_STUDIO_STORAGE_UNAVAILABLE"});}
});

const voiceMime = z.enum(["audio/wav","audio/mpeg","audio/mp4"]);
const voiceUploadRequest = key.extend({ contentType:voiceMime, size:z.number().int().min(1).max(20*1024*1024), consentConfirmed:z.literal(true) }).strict();
router.post("/voices/premium/reference/request-url",async(req,res)=>{
 const parsed=voiceUploadRequest.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_AUDIO"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const base=process.env.SUPABASE_URL?.replace(new RegExp("/$"),"");
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!base.startsWith("https://")||!base.endsWith(".supabase.co")||!secret){res.status(503).json({error:"SUPABASE_NOT_CONFIGURED"});return;}
  const {randomUUID}=await import("node:crypto");
  const path=`voice-studio/${randomUUID()}/${randomUUID()}`;
  const response=await fetch(`${base}/storage/v1/object/upload/sign/echo-media/${path}`,{
   method:"POST",headers:{Authorization:`Bearer ${secret}`,apikey:secret,"Content-Type":"application/json"},
   body:JSON.stringify({upsert:false}),signal:AbortSignal.timeout(10000)
  });
  if(!response.ok){res.status(502).json({error:"VOICE_UPLOAD_SIGN_FAILED"});return;}
  const payload=await response.json() as {url?:string;signedURL?:string;token?:string};
  const relative=payload.url??payload.signedURL;
  const uploadURL=relative?new URL(relative.startsWith("http")?relative:relative.startsWith("/storage/v1/")?`${base}${relative}`:`${base}/storage/v1/${relative.replace(/^[/]/,"")}`).toString()
   :payload.token?`${base}/storage/v1/object/upload/sign/echo-media/${path}?token=${encodeURIComponent(payload.token)}`:null;
  if(!uploadURL||!uploadURL.startsWith(`${base}/storage/v1/object/upload/sign/echo-media/`)){res.status(502).json({error:"VOICE_UPLOAD_SIGN_INVALID"});return;}
  await pool.query("INSERT INTO echo_voice_references(owner_id,universe_id,character_id,object_path,content_type,expected_size) VALUES($1,$2,$3,$4,$5,$6)",[req.userId,parsed.data.universeId,parsed.data.characterId,path,parsed.data.contentType,parsed.data.size]);
  res.json({uploadURL,objectPath:path});
 }catch{res.status(503).json({error:"VOICE_STORAGE_UNAVAILABLE"});}
});


// Confirm a reference upload only after checking the private object's bytes.
// The audio is not attached to a voice project until its metadata is persisted.
const claimReference = key.extend({objectPath:z.string().regex(/^voice-studio\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i),contentType:voiceMime,consentConfirmed:z.literal(true)}).strict();
router.post("/voices/premium/reference/verify",async(req,res)=>{
 const parsed=claimReference.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_REFERENCE"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const base=process.env.SUPABASE_URL?.replace(new RegExp("/$"),"");
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!secret){res.status(503).json({error:"SUPABASE_NOT_CONFIGURED"});return;}
  const owned=await pool.query("SELECT expected_size FROM echo_voice_references WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3 AND object_path=$4 AND content_type=$5",[req.userId,parsed.data.universeId,parsed.data.characterId,parsed.data.objectPath,parsed.data.contentType]);
  if(!owned.rowCount){res.status(404).json({error:"VOICE_REFERENCE_NOT_OWNED"});return;}
  const response=await fetch(`${base}/storage/v1/object/echo-media/${parsed.data.objectPath}`,{headers:{Authorization:`Bearer ${secret}`,apikey:secret},signal:AbortSignal.timeout(20000)});
  if(!response.ok){res.status(404).json({error:"VOICE_AUDIO_NOT_FOUND"});return;}
  const bytes=Buffer.from(await response.arrayBuffer());
  const {validMediaHeader}=await import("../lib/mediaSafety");
  const mime=(response.headers.get("content-type")??"").split(";")[0].toLowerCase();
  if(mime!==parsed.data.contentType||!bytes.length||bytes.length!==Number(owned.rows[0].expected_size)||bytes.length>20*1024*1024||!validMediaHeader(bytes.subarray(0,64),mime)){res.status(400).json({error:"INVALID_UPLOADED_VOICE_AUDIO"});return;}
  await pool.query("UPDATE echo_voice_references SET status='ready',verified_at=now() WHERE owner_id=$1 AND object_path=$2",[req.userId,parsed.data.objectPath]);
  res.json({verified:true,objectPath:parsed.data.objectPath});
 }catch{res.status(503).json({error:"VOICE_STORAGE_UNAVAILABLE"});}
});

router.get("/voices/premium/references",async(req,res)=>{
 const parsed=key.safeParse(req.query);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_PROJECT"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const result=await pool.query("SELECT id,content_type AS \"contentType\",expected_size AS \"size\",created_at AS \"createdAt\" FROM echo_voice_references WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3 AND status='ready' ORDER BY created_at DESC LIMIT 20",[req.userId,parsed.data.universeId,parsed.data.characterId]);
  res.json({references:result.rows});
 }catch{res.status(503).json({error:"VOICE_STORAGE_UNAVAILABLE"});}
});
router.get("/voices/premium/references/:id/play",async(req,res)=>{
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  const owned=await pool.query("SELECT object_path FROM echo_voice_references WHERE id=$1 AND owner_id=$2 AND status='ready'",[req.params.id,req.userId]);
  if(!owned.rowCount){res.status(404).json({error:"VOICE_REFERENCE_NOT_FOUND"});return;}
  const base=process.env.SUPABASE_URL?.replace(new RegExp("/$"),"");
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!secret){res.status(503).json({error:"SUPABASE_NOT_CONFIGURED"});return;}
  const signed=await fetch(`${base}/storage/v1/object/sign/echo-media/${owned.rows[0].object_path}`,{method:"POST",headers:{Authorization:`Bearer ${secret}`,apikey:secret,"Content-Type":"application/json"},body:JSON.stringify({expiresIn:60}),signal:AbortSignal.timeout(10000)});
  if(!signed.ok){res.status(502).json({error:"VOICE_PLAYBACK_UNAVAILABLE"});return;}
  const data=await signed.json() as {signedURL?:string};
  const raw=data.signedURL;
  if(!raw){res.status(502).json({error:"VOICE_PLAYBACK_UNAVAILABLE"});return;}
  const url=new URL(raw.startsWith("http")?raw:raw.startsWith("/storage/v1/")?`${base}${raw}`:`${base}/storage/v1/${raw.replace(/^[/]/,"")}`);
  if(url.origin!==new URL(base).origin||!url.pathname.startsWith("/storage/v1/object/sign/echo-media/")){res.status(502).json({error:"VOICE_PLAYBACK_UNAVAILABLE"});return;}
  res.json({url:url.toString(),expiresIn:60});
 }catch{res.status(503).json({error:"VOICE_STORAGE_UNAVAILABLE"});}
});
router.delete("/voices/premium/references/:id",async(req,res)=>{
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  const owned=await pool.query("SELECT object_path FROM echo_voice_references WHERE id=$1 AND owner_id=$2",[req.params.id,req.userId]);
  if(!owned.rowCount){res.status(404).json({error:"VOICE_REFERENCE_NOT_FOUND"});return;}
  const base=process.env.SUPABASE_URL?.replace(new RegExp("/$"),"");
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!secret){res.status(503).json({error:"SUPABASE_NOT_CONFIGURED"});return;}
  const removed=await fetch(`${base}/storage/v1/object/echo-media/${owned.rows[0].object_path}`,{method:"DELETE",headers:{Authorization:`Bearer ${secret}`,apikey:secret},signal:AbortSignal.timeout(10000)});
  if(!removed.ok&&removed.status!==404){res.status(502).json({error:"VOICE_DELETE_FAILED"});return;}
  await pool.query("DELETE FROM echo_voice_references WHERE id=$1 AND owner_id=$2",[req.params.id,req.userId]);
  res.json({deleted:true});
 }catch{res.status(503).json({error:"VOICE_STORAGE_UNAVAILABLE"});}
});

router.post("/voices/premium/generate",requireAuth,async(req,res)=>{
 try{if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED",charged:false});return;}}
 catch{res.status(503).json({error:"ENTITLEMENTS_UNAVAILABLE",charged:false});return;}
 res.status(503).json({error:elevenLabsVoiceStatus().reason ?? "VOICE_GENERATION_NOT_YET_ENABLED",charged:false});
});
router.post("/voices/premium/select",requireAuth,async(req,res)=>{
 const parsed=z.object({projectId:z.string().uuid(),sampleId:z.string().uuid()}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_SELECTION"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  const result=await pool.query(`UPDATE echo_voice_projects p SET selected_sample_id=$3,updated_at=now()
   WHERE p.id=$1 AND p.owner_id=$2 AND EXISTS(SELECT 1 FROM echo_voice_samples s WHERE s.id=$3 AND s.project_id=p.id AND s.owner_id=$2 AND s.status='ready')
   RETURNING p.id,p.selected_sample_id AS "selectedSampleId"`,[parsed.data.projectId,req.userId,parsed.data.sampleId]);
  if(!result.rowCount){res.status(409).json({error:"VOICE_SAMPLE_NOT_READY_OR_NOT_OWNED"});return;}
  res.json({project:result.rows[0]});
 }catch{res.status(503).json({error:"VOICE_STUDIO_STORAGE_UNAVAILABLE"});}
});
export default router;
