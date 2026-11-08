import { Router, type IRouter } from "express";
import { z } from "zod";
import { randomUUID } from "node:crypto";
import { mp3DurationSeconds } from "../lib/mp3Duration";
import { reserveCharacterAudioCredit, refundFailedCharacterAudio } from "../lib/audioCredits";
import { pool } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { SaveUniverseBody } from "@workspace/api-zod";
import { resolveEchoPlan } from "../lib/entitlements";
import { elevenLabsVoiceStatus, elevenLabsHeaders, elevenLabsCreationAllowed } from "../lib/elevenLabsVoice";

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

/** Premium's included ElevenLabs voice catalogue: read-only, never synthesizes audio. */
type ListedVoice = { voiceId:string; name:string; category:string; previewUrl:string; description:string; accent:string; language:string };
let catalogueCache: {expires:number;voices:ListedVoice[]} | null = null;
async function curatedElevenLabsVoices():Promise<ListedVoice[]> {
 if (catalogueCache && catalogueCache.expires>Date.now()) return catalogueCache.voices;
 const response=await fetch("https://api.elevenlabs.io/v2/voices?page_size=100",{
  method:"GET",headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY!.trim()},signal:AbortSignal.timeout(15000)
 });
 if(!response.ok)throw Error(`ELEVENLABS_CATALOGUE_HTTP_${response.status}`);
 const payload=await response.json() as {voices?:Array<{voice_id?:string;name?:string;category?:string;preview_url?:string;description?:string;labels?:Record<string,string>;is_legacy?:boolean;sharing?:{rate?:number;custom_rate?:number}}>;has_more?:boolean};
 const voices:ListedVoice[]=[];
 for(const v of payload.voices??[]){
  if(!v.voice_id || !/^[a-zA-Z0-9_-]{10,128}$/.test(v.voice_id) || !v.preview_url)continue;
  // Do not treat the user's private clones as a public generic preset.
  if(v.category!=="premade" || v.is_legacy===true)continue;
  // A legacy custom-rate voice may consume more provider credits than ECHO allows.
  if((v.sharing?.rate??0)>1||(v.sharing?.custom_rate??0)>1)continue;
  let preview:URL;
  try{preview=new URL(v.preview_url);}catch{continue;}
  if(preview.protocol!=="https:" || !["elevenlabs.io","storage.googleapis.com"].some(host=>preview.hostname===host||preview.hostname.endsWith(`.${host}`)))continue;
  voices.push({voiceId:v.voice_id,name:String(v.name??"Voice").slice(0,80),category:v.category??"premade",
    previewUrl:preview.toString(),description:String(v.description??"").slice(0,180),
    accent:String(v.labels?.accent??"").slice(0,40),language:String(v.labels?.language??"").slice(0,40)});
  if(voices.length>=12)break;
 }
 catalogueCache={expires:Date.now()+10*60_000,voices};
 return voices;
}
router.get("/voices/premium/catalogue",requireAuth,async(req,res)=>{
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!elevenLabsVoiceStatus().configured){res.json({voices:[],available:false});return;}
  const voices=await curatedElevenLabsVoices();
  res.json({voices,available:true});
 }catch(error){req.log.warn({reason:error instanceof Error?error.message:"UNKNOWN"},"ElevenLabs catalogue unavailable");res.status(503).json({error:"VOICE_CATALOGUE_UNAVAILABLE"});}
});
router.post("/voices/premium/catalogue/select",requireAuth,async(req,res)=>{
 const parsed=key.extend({voiceId:z.string().regex(/^[a-zA-Z0-9_-]{10,128}$/)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_CATALOGUE_SELECTION"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!elevenLabsVoiceStatus().configured){res.status(503).json({error:"VOICE_CATALOGUE_DISABLED"});return;}
  const {universeId,characterId,voiceId}=parsed.data;
  if(!await checkCharacter(req.userId!,universeId,characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const available=(await curatedElevenLabsVoices()).find(voice=>voice.voiceId===voiceId);
  if(!available){res.status(409).json({error:"VOICE_NOT_IN_APPROVED_CATALOGUE"});return;}
  const client=await pool.connect();
  try{
   await client.query("BEGIN");
   const project=await client.query(`INSERT INTO echo_voice_projects(owner_id,universe_id,character_id,mode,prompt,status)
    VALUES($1,$2,$3,'prompt',$4,'ready')
    ON CONFLICT(owner_id,universe_id,character_id) DO UPDATE SET status='ready',updated_at=now()
    RETURNING id`,[req.userId,universeId,characterId,`Catalogue: ${available.name}`]);
   const id=project.rows[0].id;
   const found=await client.query("SELECT id FROM echo_voice_samples WHERE project_id=$1 AND owner_id=$2 AND provider='elevenlabs_catalog' AND provider_sample_id=$3 AND status='ready' LIMIT 1",[id,req.userId,voiceId]);
   let sampleId=found.rows[0]?.id;
   if(!sampleId){const row=await client.query("INSERT INTO echo_voice_samples(project_id,owner_id,provider,provider_sample_id,status) VALUES($1,$2,'elevenlabs_catalog',$3,'ready') RETURNING id",[id,req.userId,voiceId]);sampleId=row.rows[0].id;}
   await client.query("UPDATE echo_voice_projects SET selected_sample_id=$2,updated_at=now() WHERE id=$1",[id,sampleId]);
   await client.query("COMMIT");
   res.json({selected:true,projectId:id,sampleId,voiceId,name:available.name});
  }catch(error){await client.query("ROLLBACK");throw error;}finally{client.release();}
 }catch(error){req.log.warn({reason:error instanceof Error?error.message:"UNKNOWN"},"ElevenLabs catalogue selection failed");res.status(503).json({error:"VOICE_CATALOGUE_SELECTION_UNAVAILABLE"});}
});

/** Owner-controlled autonomous voice budgets. Disabled until explicitly opted in. */
router.get("/voices/premium/autonomy-controls",async(req,res)=>{
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  const result=await pool.query("SELECT enabled,monthly_character_limit AS \"monthlyCharacterLimit\",max_daily_messages AS \"maxDailyMessages\",preference FROM echo_voice_budgets WHERE owner_id=$1",[req.userId]);
  res.json({controls:result.rows[0]??{enabled:false,monthlyCharacterLimit:800,maxDailyMessages:2,preference:"off"}});
 }catch{res.status(503).json({error:"VOICE_BUDGET_UNAVAILABLE"});}
});
router.put("/voices/premium/autonomy-controls",async(req,res)=>{
 const parsed=z.object({enabled:z.boolean(),preference:z.enum(["off","occasional","frequent"]),monthlyCharacterLimit:z.number().int().min(100).max(3000),maxDailyMessages:z.number().int().min(1).max(5)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_BUDGET"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  const data=parsed.data;
  const enabled=data.enabled && data.preference!=="off";
  const result=await pool.query(`INSERT INTO echo_voice_budgets(owner_id,enabled,monthly_character_limit,max_daily_messages,preference)
    VALUES($1,$2,$3,$4,$5)
    ON CONFLICT(owner_id) DO UPDATE SET enabled=EXCLUDED.enabled,monthly_character_limit=EXCLUDED.monthly_character_limit,
    max_daily_messages=EXCLUDED.max_daily_messages,preference=EXCLUDED.preference,updated_at=now()
    RETURNING enabled,monthly_character_limit AS "monthlyCharacterLimit",max_daily_messages AS "maxDailyMessages",preference`,
    [req.userId,enabled,data.monthlyCharacterLimit,data.maxDailyMessages,data.preference]);
  res.json({controls:result.rows[0]});
 }catch{res.status(503).json({error:"VOICE_BUDGET_UNAVAILABLE"});}
});

router.get("/voices/premium/projects",async(req,res)=>{
 const parsed=key.safeParse(req.query);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_PROJECT"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const result=await pool.query(`SELECT id,mode,prompt,language,variant_count AS "variantCount",consent_confirmed AS "consentConfirmed",status,selected_sample_id AS "selectedSampleId"
  FROM echo_voice_projects WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3`,[req.userId,parsed.data.universeId,parsed.data.characterId]);
  const project=result.rows[0]??null;
  const samples=project?(await pool.query(`SELECT id,status,provider,provider_sample_id AS "providerVoiceId",audio_object_path AS "audioObjectPath" FROM echo_voice_samples WHERE project_id=$1 AND owner_id=$2 ORDER BY created_at,id`,[project.id,req.userId])).rows:[];
  res.json({project,samples,generationAvailable:elevenLabsVoiceStatus(req.userId!).generationAvailable,provider:elevenLabsVoiceStatus().provider});
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
  res.json({project:result.rows[0],generationAvailable:elevenLabsVoiceStatus(req.userId!).generationAvailable});
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
  const result=await pool.query("SELECT id,object_path AS \"objectPath\",content_type AS \"contentType\",expected_size AS \"size\",created_at AS \"createdAt\" FROM echo_voice_references WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3 AND status='ready' ORDER BY created_at DESC LIMIT 20",[req.userId,parsed.data.universeId,parsed.data.characterId]);
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


/**
 * Create a persistent ElevenLabs voice from an explicitly consented, verified
 * reference recording. The browser never receives the provider API key.
 */
router.post("/voices/premium/clone",requireAuth,async(req,res)=>{
 if(!elevenLabsCreationAllowed(req.userId!)){res.status(503).json({error:"VOICE_CREATION_NOT_ENABLED"});return;}
 const parsed=key.extend({objectPath:z.string().regex(/^voice-studio\/[0-9a-f-]{36}\/[0-9a-f-]{36}$/i),consentConfirmed:z.literal(true)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_CLONE_REQUEST"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!elevenLabsVoiceStatus(req.userId!).generationAvailable){res.status(503).json({error:"CUSTOM_VOICE_PROVIDER_UNAVAILABLE"});return;}
  const {universeId,characterId,objectPath}=parsed.data;
  if(!await checkCharacter(req.userId!,universeId,characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const reference=await pool.query("SELECT content_type FROM echo_voice_references WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3 AND object_path=$4 AND status='ready'",[req.userId,universeId,characterId,objectPath]);
  if(!reference.rowCount){res.status(404).json({error:"VERIFIED_REFERENCE_NOT_FOUND"});return;}
  // Reserve a clone before contacting the paid provider, so duplicate taps
  // cannot create multiple costly voices for the same character.
  let cloneReservationId:string|null=null;
  res.once("finish",()=>{if(cloneReservationId)void pool.query("UPDATE echo_voice_samples SET status='failed' WHERE id=$1 AND owner_id=$2 AND status='pending'",[cloneReservationId,req.userId]).catch(()=>{});});
  const reservationClient=await pool.connect();
  try{
   await reservationClient.query("BEGIN");
   await reservationClient.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[req.userId,universeId+":"+characterId+":clone"]);
   const projectForClone=await reservationClient.query("INSERT INTO echo_voice_projects(owner_id,universe_id,character_id,mode,consent_confirmed,status) VALUES($1,$2,$3,'reference',true,'draft') ON CONFLICT(owner_id,universe_id,character_id) DO UPDATE SET consent_confirmed=true,updated_at=now() RETURNING id",[req.userId,universeId,characterId]);
   const existing=await reservationClient.query("SELECT 1 FROM echo_voice_samples WHERE project_id=$1 AND owner_id=$2 AND provider='elevenlabs_clone' AND (created_at>now()-interval '24 hours' OR (status='ready' AND created_at>=date_trunc('month',now()))) LIMIT 1",[projectForClone.rows[0].id,req.userId]);
   if(existing.rowCount){await reservationClient.query("ROLLBACK");res.status(429).json({error:"VOICE_CLONE_RATE_LIMIT"});return;}
   const reserved=await reservationClient.query("INSERT INTO echo_voice_samples(project_id,owner_id,provider,status) VALUES($1,$2,'elevenlabs_clone','pending') RETURNING id",[projectForClone.rows[0].id,req.userId]);
   cloneReservationId=reserved.rows[0].id;
   await reservationClient.query("COMMIT");
  }catch(error){await reservationClient.query("ROLLBACK").catch(()=>{});throw error;}
  finally{reservationClient.release();}
  const base=process.env.SUPABASE_URL?.replace(/\/$/,""),secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!secret)throw Error("VOICE_STORAGE_NOT_CONFIGURED");
  const audioResponse=await fetch(`${base}/storage/v1/object/echo-media/${objectPath}`,{headers:{Authorization:`Bearer ${secret}`,apikey:secret},signal:AbortSignal.timeout(20000)});
  if(!audioResponse.ok){res.status(404).json({error:"VOICE_REFERENCE_AUDIO_NOT_FOUND"});return;}
  const bytes=Buffer.from(await audioResponse.arrayBuffer());
  if(bytes.length<100||bytes.length>20*1024*1024){res.status(400).json({error:"VOICE_REFERENCE_SIZE_INVALID"});return;}
  const mime=String(reference.rows[0].content_type);
  const ext=mime==="audio/wav"?"wav":mime==="audio/mpeg"?"mp3":"m4a";
  const form=new FormData();
  form.append("name",`ECHO ${characterId.slice(0,48)}`);
  form.append("description","User-authorized custom character voice created in ECHO");
  form.append("files",new Blob([bytes],{type:mime}),`reference.${ext}`);
  const createdResponse=await fetch("https://api.elevenlabs.io/v1/voices/add",{
   method:"POST",headers:{"xi-api-key":process.env.ELEVENLABS_API_KEY!.trim()},body:form,signal:AbortSignal.timeout(60000)
  });
  if(!createdResponse.ok){
   req.log.warn({providerStatus:createdResponse.status},"ElevenLabs voice cloning request rejected");
   res.status(502).json({error:"ELEVENLABS_VOICE_CLONE_FAILED",providerStatus:createdResponse.status});return;
  }
  const created=await createdResponse.json() as {voice_id?:string;requires_verification?:boolean};
  if(created.requires_verification){res.status(409).json({error:"VOICE_PROVIDER_VERIFICATION_REQUIRED"});return;}
  if(!created.voice_id||!/^[a-zA-Z0-9_-]{10,128}$/.test(created.voice_id)){res.status(502).json({error:"ELEVENLABS_VOICE_ID_INVALID"});return;}
  const projectResult=await pool.query(`INSERT INTO echo_voice_projects(owner_id,universe_id,character_id,mode,consent_confirmed,status)
   VALUES($1,$2,$3,'reference',true,'ready')
   ON CONFLICT(owner_id,universe_id,character_id) DO UPDATE SET mode='reference',consent_confirmed=true,status='ready',updated_at=now()
   RETURNING id`,[req.userId,universeId,characterId]);
  const projectId=projectResult.rows[0].id;
  const sample=await pool.query("UPDATE echo_voice_samples SET provider_sample_id=$2,status='ready' WHERE id=$1 AND owner_id=$3 RETURNING id",[cloneReservationId,created.voice_id,req.userId]);
  await pool.query("UPDATE echo_voice_projects SET selected_sample_id=$2,updated_at=now() WHERE id=$1 AND owner_id=$3",[projectId,sample.rows[0].id,req.userId]);
  cloneReservationId=null;
  res.json({cloned:true,projectId,sampleId:sample.rows[0].id});
 }catch(error){
  req.log.error({err:error},"Premium voice cloning failed");
  if(!res.headersSent)res.status(503).json({error:"VOICE_CLONING_UNAVAILABLE"});
 }
});

router.post("/voices/premium/generate",requireAuth,async(req,res)=>{
 if(!elevenLabsCreationAllowed(req.userId!)){res.status(503).json({error:"VOICE_CREATION_NOT_ENABLED"});return;}
 const parsed=key.safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_PROJECT",charged:false});return;}
 const availability=elevenLabsVoiceStatus();
 if(!availability.generationAvailable){res.status(503).json({error:availability.reason,charged:false});return;}
 try {
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED",charged:false});return;}
  const {universeId,characterId}=parsed.data;
  if(!await checkCharacter(req.userId!,universeId,characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND",charged:false});return;}
  const projectResult=await pool.query("SELECT * FROM echo_voice_projects WHERE owner_id=$1 AND universe_id=$2 AND character_id=$3",[req.userId,universeId,characterId]);
  const project=projectResult.rows[0];
  if(!project || project.mode!=="prompt" || project.prompt.trim().length<20 || project.prompt.length>1000){
   res.status(400).json({error:"VOICE_PROMPT_MUST_BE_20_TO_1000_CHARACTERS",charged:false});return;
  }
  // Limit costly previews to one batch per project per month. No automatic retries.
  const month=new Date().toISOString().slice(0,7);
  const client=await pool.connect();
  let reserved=false; let reservationId:string|null=null;
  try {
   await client.query("BEGIN");
   await client.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext($2))",[req.userId,project.id]);
   const previous=await client.query("SELECT count(*)::int AS count FROM echo_voice_samples WHERE project_id=$1 AND owner_id=$2 AND provider='elevenlabs' AND status IN ('pending','ready') AND created_at>=($3 || '-01')::date",[project.id,req.userId,month]);
   if(Number(previous.rows[0].count)>0){await client.query("ROLLBACK");res.status(429).json({error:"VOICE_DESIGN_MONTHLY_PREVIEW_LIMIT",charged:false});return;}
   const reservation=await client.query("INSERT INTO echo_voice_samples(project_id,owner_id,provider,status) VALUES($1,$2,'elevenlabs','pending') RETURNING id",[project.id,req.userId]);reservationId=reservation.rows[0].id;
   await client.query("COMMIT");reserved=true;
  }catch(e){await client.query("ROLLBACK");throw e;}finally{client.release();}
  if(!reserved)return;
  const controller=new AbortController();
  const timer=setTimeout(()=>controller.abort(),45000);
  let response:Response;
  try{
   response=await fetch("https://api.elevenlabs.io/v1/text-to-voice/design",{
    method:"POST",headers:elevenLabsHeaders(),signal:controller.signal,
    body:JSON.stringify({model_id:"eleven_multilingual_ttv_v2",voice_description:project.prompt,auto_generate_text:true})
   });
  }finally{clearTimeout(timer);}
  if(!response.ok){await pool.query("UPDATE echo_voice_samples SET status=$2 WHERE id=$1",[reservationId,"failed"]);let providerDetail="unknown";try{const payload=await response.json() as {detail?:{status?:string;message?:string}|string};const detail=payload.detail;providerDetail=typeof detail==="object"&&detail!==null?String(detail.status??"unknown"):typeof detail==="string"?detail.slice(0,100):"unknown";}catch{}console.error("[voice-design] ElevenLabs request rejected",{providerStatus:response.status,providerDetail:providerDetail.replace(/[^a-zA-Z0-9_ -]/g,"").slice(0,100),category:response.status===402?"PAYMENT_REQUIRED":response.status===401||response.status===403?"AUTH_OR_PERMISSION":response.status===429?"RATE_OR_CREDIT_LIMIT":"PROVIDER_REJECTED"});res.status(502).json({error:"ELEVENLABS_VOICE_DESIGN_FAILED",providerStatus:response.status,charged:"unknown"});return;}
  const data=await response.json() as {previews?:{audio_base_64:string;generated_voice_id:string;media_type?:string}[]};
  const previews=(data.previews??[]).slice(0,project.variant_count);
  const base=process.env.SUPABASE_URL?.replace(/\/$/,"");
  const secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!secret)throw Error("VOICE_STORAGE_NOT_CONFIGURED");
  const stored:{id:string}[]=[];
  for(const preview of previews){
   if(!preview.generated_voice_id || !preview.audio_base_64)continue;
   const audio=Buffer.from(preview.audio_base_64,"base64");
   if(audio.length<100||audio.length>5*1024*1024)continue;
   const {randomUUID}=await import("node:crypto");
   const path=`voice-studio/previews/${project.id}/${randomUUID()}.mp3`;
   const upload=await fetch(`${base}/storage/v1/object/echo-media/${path}`,{
    method:"POST",headers:{Authorization:`Bearer ${secret}`,apikey:secret,"Content-Type":"audio/mpeg","x-upsert":"false"},body:audio
   });
   if(!upload.ok)continue;
   const inserted=await pool.query("INSERT INTO echo_voice_samples(project_id,owner_id,provider,provider_sample_id,audio_object_path,status) VALUES($1,$2,'elevenlabs',$3,$4,'ready') RETURNING id",[project.id,req.userId,preview.generated_voice_id,path]);
   stored.push({id:inserted.rows[0].id});
  }
  if(!stored.length){await pool.query("UPDATE echo_voice_samples SET status=$2 WHERE id=$1",[reservationId,"failed"]);res.status(502).json({error:"VOICE_PREVIEWS_COULD_NOT_BE_STORED",charged:"unknown"});return;}
  // The reservation is not a playable sample. Remove it once real samples are stored;
  // the ready samples themselves enforce the monthly preview limit.
  await pool.query("DELETE FROM echo_voice_samples WHERE id=$1 AND owner_id=$2 AND status='pending'",[reservationId,req.userId]);
  await pool.query("UPDATE echo_voice_projects SET status='ready',updated_at=now() WHERE id=$1 AND owner_id=$2",[project.id,req.userId]);
  res.json({projectId:project.id,samples:stored,generated:stored.length});
 }catch(error){
  req.log.error({message:error instanceof Error?error.message:"UNKNOWN",code:typeof error==="object"&&error!==null&&"code" in error?String(error.code):"UNKNOWN"},"Premium voice design request failed");
  if(!res.headersSent)res.status(503).json({error:"VOICE_GENERATION_UNAVAILABLE",charged:"unknown"});
 }
});
router.get("/voices/premium/samples/:id/play",requireAuth,async(req,res)=>{
 if(!z.string().uuid().safeParse(req.params.id).success){res.status(400).json({error:"INVALID_SAMPLE"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  const result=await pool.query("SELECT audio_object_path FROM echo_voice_samples WHERE id=$1 AND owner_id=$2 AND status='ready'",[req.params.id,req.userId]);
  if(!result.rowCount){res.status(404).json({error:"SAMPLE_NOT_FOUND"});return;}
  const base=process.env.SUPABASE_URL?.replace(/\/$/,""),secret=process.env.SUPABASE_SERVICE_ROLE_KEY;
  if(!base||!secret)throw Error("STORAGE_NOT_CONFIGURED");
  const response=await fetch(`${base}/storage/v1/object/sign/echo-media/${result.rows[0].audio_object_path}`,{method:"POST",headers:{Authorization:`Bearer ${secret}`,apikey:secret,"Content-Type":"application/json"},body:JSON.stringify({expiresIn:120})});
  if(!response.ok)throw Error("SIGNED_URL_FAILED");
  const data=await response.json() as {signedURL?:string};
  res.json({url:new URL(data.signedURL!,base).toString()});
 }catch{res.status(503).json({error:"VOICE_SAMPLE_PLAYBACK_UNAVAILABLE"});}
});
/**
 * Manual premium speech: only the owner's selected ready sample can speak.
 * Voice design previews remain a separate provider-cost flow.
 */
router.post("/voices/premium/synthesize",requireAuth,async(req,res)=>{
 if(!elevenLabsVoiceStatus(req.userId!).generationAvailable){res.status(503).json({error:"VOICE_TEST_NOT_ENABLED"});return;}
 const parsed=key.extend({text:z.string().trim().min(1).max(100)}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_REQUEST"});return;}
 const {universeId,characterId,text}=parsed.data;
 let operation:string|null=null;
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!await checkCharacter(req.userId!,universeId,characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const selected=await pool.query<{provider_sample_id:string}>(`SELECT s.provider_sample_id
   FROM echo_voice_projects p JOIN echo_voice_samples s ON s.id=p.selected_sample_id
   WHERE p.owner_id=$1 AND p.universe_id=$2 AND p.character_id=$3
    AND s.owner_id=$1 AND s.project_id=p.id AND s.status='ready'
    AND s.provider IN ('elevenlabs','elevenlabs_catalog','elevenlabs_clone') AND s.provider_sample_id IS NOT NULL LIMIT 1`,
   [req.userId,universeId,characterId]);
  const voiceId=selected.rows[0]?.provider_sample_id;
  if(!voiceId || !/^[a-zA-Z0-9_-]{10,128}$/.test(voiceId)){res.status(409).json({error:"CUSTOM_VOICE_NOT_SELECTED"});return;}
  if(!elevenLabsVoiceStatus(req.userId!).generationAvailable){res.status(503).json({error:"CUSTOM_VOICE_PROVIDER_UNAVAILABLE"});return;}
  // A bounded one-off production test, not an unmetered synthesis endpoint.
  const gate=await pool.connect();
  let testId:string;
  try{
    await gate.query("BEGIN");
    await gate.query("SELECT pg_advisory_xact_lock(hashtext($1),hashtext('elevenlabs-one-off-test'))",[req.userId]);
    const previous=await gate.query(`SELECT count(*)::int AS count FROM echo_voice_usage
      WHERE owner_id=$1 AND message_id LIKE 'eleven-test-%' AND created_at>=now()-interval '24 hours'`,[req.userId]);
    if(Number(previous.rows[0].count)>=2){
      await gate.query("ROLLBACK");res.status(429).json({error:"VOICE_TEST_DAILY_LIMIT"});return;
    }
    testId='eleven-test-'+randomUUID();
    await gate.query("INSERT INTO echo_voice_usage(owner_id,message_id,month_key,character_id,characters,status) VALUES($1,$2,to_char(now() at time zone 'UTC','YYYY-MM'),$3,$4,'reserved')",
      [req.userId,testId,characterId,text.length]);
    await gate.query("COMMIT");
  }catch(error){await gate.query("ROLLBACK").catch(()=>{});throw error;}finally{gate.release();}
  operation=randomUUID();
  const charge=await reserveCharacterAudioCredit({ownerId:req.userId!,characterId,requestKey:operation,engine:"custom",requestedSeconds:30});
  if(!charge.allowed){res.status(402).json({error:charge.reason,remainingCredits:charge.remaining});return;}
  const response=await fetch(`https://api.elevenlabs.io/v1/text-to-speech/${encodeURIComponent(voiceId)}`,{
   method:"POST",headers:{...elevenLabsHeaders(),"Content-Type":"application/json","Accept":"audio/mpeg"},
   body:JSON.stringify({text,model_id:"eleven_multilingual_v2",output_format:"mp3_44100_128"}),
   signal:AbortSignal.timeout(45000)
  });
  if(!response.ok){await refundFailedCharacterAudio(req.userId!,operation);operation=null;res.status(502).json({error:"CUSTOM_VOICE_GENERATION_FAILED"});return;}
  const audio=Buffer.from(await response.arrayBuffer());
  if(audio.length<100 || audio.length>10*1024*1024){await refundFailedCharacterAudio(req.userId!,operation);operation=null;res.status(502).json({error:"CUSTOM_VOICE_INVALID_AUDIO"});return;}
  const duration=mp3DurationSeconds(audio);
  if(duration===null || duration<=0 || duration>30){
   await refundFailedCharacterAudio(req.userId!,operation);operation=null;
   res.status(502).json({error:"CUSTOM_VOICE_AUDIO_DURATION_INVALID"});return;
  }
  res.setHeader("Content-Type","audio/mpeg");
  res.setHeader("Cache-Control","private, no-store");
  res.send(audio);
 }catch(error){
  if(operation) await refundFailedCharacterAudio(req.userId!,operation).catch(()=>{});
  req.log.error({err:error},"Premium voice synthesis failed");
  if(!res.headersSent)res.status(503).json({error:"CUSTOM_VOICE_UNAVAILABLE"});
 }
});

router.post("/voices/premium/select",requireAuth,async(req,res)=>{
 if(!elevenLabsCreationAllowed(req.userId!)){res.status(503).json({error:"VOICE_CREATION_NOT_ENABLED"});return;}
 const parsed=z.object({projectId:z.string().uuid(),sampleId:z.string().uuid()}).strict().safeParse(req.body);
 if(!parsed.success){res.status(400).json({error:"INVALID_VOICE_SELECTION"});return;}
 try{
  if(await resolveEchoPlan(req.userId!)!=="premium"){res.status(403).json({error:"ECHO_PREMIUM_REQUIRED"});return;}
  if(!elevenLabsVoiceStatus(req.userId!).generationAvailable){res.status(503).json({error:"CUSTOM_VOICE_PROVIDER_UNAVAILABLE"});return;}
  const projectResult=await pool.query(`SELECT p.id,p.owner_id,p.universe_id,p.character_id,p.prompt,p.selected_sample_id,
    s.id AS sample_id,s.provider_sample_id,s.status AS sample_status
    FROM echo_voice_projects p JOIN echo_voice_samples s ON s.project_id=p.id
    WHERE p.id=$1 AND p.owner_id=$2 AND s.id=$3 AND s.owner_id=$2 AND s.status='ready'`,
    [parsed.data.projectId,req.userId,parsed.data.sampleId]);
  const project=projectResult.rows[0];
  if(!project){res.status(409).json({error:"VOICE_SAMPLE_NOT_READY_OR_NOT_OWNED"});return;}
  if(project.selected_sample_id===parsed.data.sampleId){
    res.json({project:{id:project.id,selectedSampleId:project.selected_sample_id},alreadySelected:true});return;
  }
  if(!project.prompt || project.prompt.trim().length<20 || project.prompt.length>1000){
    res.status(409).json({error:"VOICE_DESCRIPTION_UNAVAILABLE"});return;
  }
  const {state}=await readUniverse(req.userId!,project.universe_id);
  const character=(Array.isArray(state?.characters)?state.characters:[]).find((item:any)=>item?.id===project.character_id);
  if(!character){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
  const createResponse=await fetch("https://api.elevenlabs.io/v1/text-to-voice",{
    method:"POST",headers:elevenLabsHeaders(),
    body:JSON.stringify({
      voice_name:String(character.name??"ECHO Character").slice(0,80),
      voice_description:project.prompt,
      generated_voice_id:project.provider_sample_id,
      labels:{application:"ECHO",character_id:String(project.character_id).slice(0,64)}
    }),
    signal:AbortSignal.timeout(30000)
  });
  if(!createResponse.ok){
    let providerStatus=createResponse.status;
    req.log.warn({providerStatus},"ElevenLabs could not save selected voice preview");
    res.status(502).json({error:"ELEVENLABS_VOICE_SAVE_FAILED",providerStatus});return;
  }
  const created=await createResponse.json() as {voice_id?:string};
  if(!created.voice_id || !/^[a-zA-Z0-9_-]{10,128}$/.test(created.voice_id)){
    res.status(502).json({error:"ELEVENLABS_VOICE_ID_INVALID"});return;
  }
  const previous=await pool.query(`SELECT s.provider_sample_id FROM echo_voice_projects p
    JOIN echo_voice_samples s ON s.id=p.selected_sample_id
    WHERE p.id=$1 AND p.owner_id=$2 AND s.provider='elevenlabs'`,
    [project.id,req.userId]);
  await pool.query("UPDATE echo_voice_samples SET provider_sample_id=$3 WHERE id=$1 AND owner_id=$2",
    [parsed.data.sampleId,req.userId,created.voice_id]);
  const result=await pool.query(`UPDATE echo_voice_projects SET selected_sample_id=$3,updated_at=now()
    WHERE id=$1 AND owner_id=$2 RETURNING id,selected_sample_id AS "selectedSampleId"`,
    [project.id,req.userId,parsed.data.sampleId]);
  // Remove a previously selected ECHO-created voice after the replacement is safely saved.
  const oldVoiceId=previous.rows[0]?.provider_sample_id;
  if(oldVoiceId && oldVoiceId!==created.voice_id){
    await fetch(`https://api.elevenlabs.io/v1/voices/${encodeURIComponent(oldVoiceId)}`,{
      method:"DELETE",headers:elevenLabsHeaders(),signal:AbortSignal.timeout(15000)
    }).catch(()=>{});
  }
  res.json({project:result.rows[0],voiceCreated:true});
 }catch(error){
  req.log.error({err:error},"Premium voice selection failed");
  res.status(503).json({error:"VOICE_STUDIO_STORAGE_UNAVAILABLE"});
 }
});
export default router;
