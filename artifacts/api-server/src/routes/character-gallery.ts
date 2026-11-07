import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, echoCharacterGalleryTable, echoUniversesTable } from "@workspace/db";
import { requireAuth } from "../middlewares/requireAuth";
import { visionService } from "../vision/service";

const id = z.string().min(1).max(120);
const scope = z.object({ universeId: id, characterId: id });
const create = scope.extend({ mediaRef: z.string().min(1).max(2048), reusable: z.boolean().default(false), description: z.string().max(500).default("") }).strict();
const change = z.object({ reusable: z.boolean().optional(), reserved: z.boolean().optional(), description: z.string().max(500).optional() }).strict().refine(v => v.reusable !== undefined || v.reserved !== undefined || v.description !== undefined);
const router: IRouter = Router();
router.use("/character-gallery", requireAuth);
async function belongs(ownerId: string, universeId: string, characterId: string) {
  const rows = await db.select({ state: echoUniversesTable.state }).from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, ownerId),eq(echoUniversesTable.universeId, universeId))).limit(1);
  return Array.isArray(rows[0]?.state?.characters) && (rows[0].state.characters as Array<{id?:string;archived?:boolean}>).some(c => c.id === characterId && !c.archived);
}
router.get("/character-gallery", async (req,res):Promise<void> => {
  const parsed=scope.safeParse(req.query);
  if(!parsed.success){res.status(400).json({error:"INVALID_GALLERY_SCOPE"});return;}
  try {
    if(!await belongs(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
    const photos=await db.select().from(echoCharacterGalleryTable).where(and(eq(echoCharacterGalleryTable.ownerId,req.userId!),eq(echoCharacterGalleryTable.universeId,parsed.data.universeId),eq(echoCharacterGalleryTable.characterId,parsed.data.characterId)));
    res.setHeader("Cache-Control","private, no-store");res.json({photos});
  }catch{res.status(503).json({error:"GALLERY_UNAVAILABLE"});}
});
router.post("/character-gallery", async (req,res):Promise<void> => {
  const parsed=create.safeParse(req.body);
  if(!parsed.success || !parsed.data.mediaRef || parsed.data.mediaRef.includes("..")){res.status(400).json({error:"INVALID_GALLERY_PHOTO"});return;}
  try{
    if(!await belongs(req.userId!,parsed.data.universeId,parsed.data.characterId)){res.status(404).json({error:"CHARACTER_NOT_FOUND"});return;}
    const [photo]=await db.insert(echoCharacterGalleryTable).values({...parsed.data,ownerId:req.userId!}).returning();res.status(201).json({photo});
  }catch{res.status(503).json({error:"GALLERY_UNAVAILABLE"});}
});
router.post("/character-gallery/:photoId/analyze", async(req,res):Promise<void> => {
  const ownerId=req.userId!;
  try {
    const [photo]=await db.select().from(echoCharacterGalleryTable).where(and(
      eq(echoCharacterGalleryTable.id,req.params.photoId as string),
      eq(echoCharacterGalleryTable.ownerId,ownerId),
    )).limit(1);
    if(!photo){res.status(404).json({error:"PHOTO_NOT_FOUND"});return;}
    if(photo.visionStatus==="complete" && photo.visionAnalysis){res.json({photo});return;}
    const analysis=await visionService.analyzeGalleryPhoto(ownerId,photo.universeId,photo.id,photo.mediaRef);
    const [updated]=await db.update(echoCharacterGalleryTable).set({visionAnalysis:analysis,visionStatus:"complete"})
      .where(and(eq(echoCharacterGalleryTable.id,photo.id),eq(echoCharacterGalleryTable.ownerId,ownerId))).returning();
    res.json({photo:updated});
  }catch(error){
    const code=error instanceof Error && error.name==="VisionError" ? error.message : "GALLERY_VISION_UNAVAILABLE";
    res.status(503).json({error:code});
  }
});
router.patch("/character-gallery/:photoId", async(req,res):Promise<void> => {
  const parsed=change.safeParse(req.body);
  if(!parsed.success){res.status(400).json({error:"INVALID_GALLERY_CHANGE"});return;}
  try{
    const [photo]=await db.update(echoCharacterGalleryTable).set(parsed.data).where(and(eq(echoCharacterGalleryTable.id,req.params.photoId as string),eq(echoCharacterGalleryTable.ownerId,req.userId!))).returning();
    if(!photo){res.status(404).json({error:"PHOTO_NOT_FOUND"});return;}res.json({photo});
  }catch{res.status(503).json({error:"GALLERY_UNAVAILABLE"});}
});
router.delete("/character-gallery/:photoId", async(req,res):Promise<void> => {
  try{
    const [photo]=await db.delete(echoCharacterGalleryTable).where(and(eq(echoCharacterGalleryTable.id,req.params.photoId as string),eq(echoCharacterGalleryTable.ownerId,req.userId!))).returning({id:echoCharacterGalleryTable.id});
    if(!photo){res.status(404).json({error:"PHOTO_NOT_FOUND"});return;}res.json({deleted:true});
  }catch{res.status(503).json({error:"GALLERY_UNAVAILABLE"});}
});
export { router as characterGalleryRouter };
