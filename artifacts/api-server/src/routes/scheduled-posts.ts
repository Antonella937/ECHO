import { Router, type IRouter } from "express";
import { z } from "zod";
import { and, eq } from "drizzle-orm";
import { db, echoScheduledPostsTable, echoCharacterGalleryTable } from "@workspace/db";
import { readUniverse } from "../lib/universeRepository";
import { requireAuth } from "../middlewares/requireAuth";
const router:IRouter=Router();router.use("/scheduled-posts",requireAuth);
const professional=new Set(["artist","band","business","venue","organization"]);
const scope=z.object({universeId:z.string().min(1).max(120),characterId:z.string().min(1).max(120)});
async function allowed(ownerId:string,universeId:string,characterId:string) {
 const u=await readUniverse(ownerId,universeId);
 return (u.state?.characters as Array<{id:string;accountType?:string;archived?:boolean}>|undefined)?.some(c=>c.id===characterId&&!c.archived&&professional.has(c.accountType??"personal"))??false;
}
router.get("/scheduled-posts",async(req,res):Promise<void>=>{
 const q=scope.safeParse(req.query);if(!q.success){res.status(400).json({error:"INVALID_SCOPE"});return;}
 if(!await allowed(req.userId!,q.data.universeId,q.data.characterId)){res.status(403).json({error:"PROFESSIONAL_ACCOUNT_REQUIRED"});return;}
 const posts=await db.select().from(echoScheduledPostsTable).where(and(eq(echoScheduledPostsTable.ownerId,req.userId!),eq(echoScheduledPostsTable.universeId,q.data.universeId),eq(echoScheduledPostsTable.characterId,q.data.characterId)));
 res.json({posts});
});
router.post("/scheduled-posts",async(req,res):Promise<void>=>{
 const body=scope.extend({galleryPhotoId:z.string().uuid(),caption:z.string().max(600),scheduledAt:z.string().datetime({offset:true})}).safeParse(req.body);
 if(!body.success){res.status(400).json({error:"INVALID_SCHEDULE"});return;}
 const {universeId,characterId,galleryPhotoId,caption,scheduledAt}=body.data;
 const date=new Date(scheduledAt);
 if(date.getTime()<=Date.now()+30000){res.status(400).json({error:"SCHEDULE_MUST_BE_FUTURE"});return;}
 if(!await allowed(req.userId!,universeId,characterId)){res.status(403).json({error:"PROFESSIONAL_ACCOUNT_REQUIRED"});return;}
 const [photo]=await db.select().from(echoCharacterGalleryTable).where(and(eq(echoCharacterGalleryTable.id,galleryPhotoId),eq(echoCharacterGalleryTable.ownerId,req.userId!),eq(echoCharacterGalleryTable.universeId,universeId),eq(echoCharacterGalleryTable.characterId,characterId))).limit(1);
 if(!photo){res.status(404).json({error:"GALLERY_PHOTO_NOT_FOUND"});return;}
 const [post]=await db.insert(echoScheduledPostsTable).values({ownerId:req.userId!,universeId,characterId,galleryPhotoId,caption,scheduledAt:date}).returning();
 res.status(201).json({post});
});
router.delete("/scheduled-posts/:id",async(req,res):Promise<void>=>{
 const [post]=await db.update(echoScheduledPostsTable).set({status:"cancelled"}).where(and(eq(echoScheduledPostsTable.id,req.params.id as string),eq(echoScheduledPostsTable.ownerId,req.userId!),eq(echoScheduledPostsTable.status,"pending"))).returning();
 if(!post){res.status(404).json({error:"PENDING_POST_NOT_FOUND"});return;}res.json({post});
});
export {router as scheduledPostsRouter};