import { randomUUID } from "node:crypto";
import { and, eq, lte } from "drizzle-orm";
import { db, echoScheduledPostsTable, echoUniversesTable, echoCharacterGalleryTable } from "@workspace/db";
const professional = new Set(["artist","band","business","venue","organization"]);
export async function publishDueScheduledPosts(now = new Date()) {
 const due = await db.select({id:echoScheduledPostsTable.id}).from(echoScheduledPostsTable)
  .where(and(eq(echoScheduledPostsTable.status,"pending"),lte(echoScheduledPostsTable.scheduledAt,now))).limit(50);
 for (const item of due) {
  try {
   await db.transaction(async tx => {
    const [job] = await tx.select().from(echoScheduledPostsTable).where(eq(echoScheduledPostsTable.id,item.id)).for("update").limit(1);
    if (!job || job.status !== "pending" || job.scheduledAt > now) return;
    const [universe] = await tx.select().from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId,job.ownerId),eq(echoUniversesTable.universeId,job.universeId))).for("update").limit(1);
    const state = universe?.state as Record<string,unknown> | undefined;
    const characters = state?.characters as Array<{id:string;accountType?:string;archived?:boolean}> | undefined;
    const valid = !universe?.archivedAt && !universe?.deletedAt && characters?.some(c=>c.id===job.characterId && !c.archived && professional.has(c.accountType ?? "personal"));
    const [photo] = await tx.select().from(echoCharacterGalleryTable).where(and(eq(echoCharacterGalleryTable.id,job.galleryPhotoId),eq(echoCharacterGalleryTable.ownerId,job.ownerId),eq(echoCharacterGalleryTable.universeId,job.universeId),eq(echoCharacterGalleryTable.characterId,job.characterId))).limit(1);
    if (!valid || !photo || !state || !Array.isArray(state.posts)) {
     await tx.update(echoScheduledPostsTable).set({status:"failed"}).where(eq(echoScheduledPostsTable.id,job.id));return;
    }
    const postId=randomUUID();
    const post={id:postId,authorId:job.characterId,image:photo.mediaRef,media:[{id:randomUUID(),type:"image",url:photo.mediaRef}],caption:job.caption,location:"",createdAt:now.toISOString(),likes:[],savedBy:[],origin:"user",illustrative:false,commentsEnabled:true};
    await tx.update(echoUniversesTable).set({state:{...state,posts:[...state.posts,post]},revision:universe!.revision+1,updatedAt:now}).where(and(eq(echoUniversesTable.ownerId,job.ownerId),eq(echoUniversesTable.universeId,job.universeId)));
    await tx.update(echoCharacterGalleryTable).set({usedCount:photo.usedCount+1,lastUsedAt:now}).where(eq(echoCharacterGalleryTable.id,photo.id));
    await tx.update(echoScheduledPostsTable).set({status:"published",postId,publishedAt:now}).where(eq(echoScheduledPostsTable.id,job.id));
   });
  } catch(error) { console.error("Scheduled post execution failed",item.id,error); }
 }
}