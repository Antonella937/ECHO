import { and, eq, sql } from "drizzle-orm";
import { db, echoUniversesTable } from "@workspace/db";
import { SaveUniverseBody } from "@workspace/api-zod";
import { spendCredits, refundCredits } from "../lib/creditWallet";
import { canGenerateImages } from "../lib/imageGenerationAccess";
import { paidImageGenerationActivated } from "../lib/imageGenerationActivation";
import { generateCharacterImage } from "../lib/imageGenerationService";
import { buildCharacterImagePrompt } from "../lib/imagePromptBuilder";
import { narratedCameraShot } from "./dm-camera-policy";

export async function deliverNarratedDmPhoto(input: {
  ownerId: string; universeId: string; characterId: string; messageId: string;
}) {
  if (process.env.ECHO_NARRATED_DM_PHOTOS_OWNER_ID !== input.ownerId ||
      !canGenerateImages(input.ownerId) || !paidImageGenerationActivated() || !process.env.FAL_KEY) return;
  const { ownerId, universeId, characterId, messageId } = input;
  const scope = and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId));
  const [universe] = await db.select().from(echoUniversesTable).where(scope).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) return;
  const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
  if (!parsed.success) return;
  const sender = parsed.data.characters.find(character => character.id === characterId && !character.archived);
  const message = parsed.data.messages.find(item => item.id === messageId && item.senderId === characterId &&
    item.recipientId === parsed.data.primaryCharacterId && item.origin === "autonomy");
  if (!sender || !message || message.attachments?.some(item => item.type === "image")) return;
  const scene = narratedCameraShot(message.text);
  if (!scene) return;
  const linked = await db.execute(sql`SELECT 1 FROM echo_kindroid_character_links
    WHERE owner_id=${ownerId} AND universe_id=${universeId} AND character_id=${characterId} AND enabled=true LIMIT 1`);
  if (!linked.rows.length) return;
  const reserved = await db.transaction(async tx => {
    await tx.execute(sql`SELECT pg_advisory_xact_lock(hashtext(${ownerId}), 482906)`);
    const count = await tx.execute(sql`SELECT count(*)::int AS attempts FROM echo_dm_camera_attempts
      WHERE owner_id=${ownerId} AND created_at >= now() - interval '24 hours'`);
    if (Number(count.rows[0]?.attempts) >= 1) return false;
    const attempt = await tx.execute(sql`INSERT INTO echo_dm_camera_attempts(owner_id, universe_id, message_id)
      VALUES (${ownerId}, ${universeId}, ${messageId}) ON CONFLICT DO NOTHING RETURNING message_id`);
    return attempt.rows.length === 1;
  });
  if (!reserved) return;

  const selfie = /\bselfie\b/i.test(scene);
  const reference = selfie ? [...(sender.identity?.referenceImages ?? []), sender.avatar]
    .find(path => typeof path === "string" && /^\/objects\/(?:uploads|r2)\/[0-9a-f-]{36}$/i.test(path)) : undefined;
  const instruction = selfie
    ? "Create the actual candid phone selfie narrated by the sender. Show the resulting photograph, not a phone UI."
    : "Create the resulting candid photograph, from the photographer's point of view. Keep the photographer out of frame.";
  const prompt = selfie
    ? buildCharacterImagePrompt({ name: sender.name, scene: instruction + "\n" + scene, style: "phone", identity: sender.identity ?? {} })
    : instruction + "\n" + scene;

  const charge = await spendCredits(ownerId, "photo", 1, messageId);
  if (!charge.charged) return;
  let delivered = false;
  try {
    const generated = await generateCharacterImage({ ownerId, universeId, characterId,
      preparedPrompt: prompt, style: "phone", referencePaths: reference ? [reference] : [] });
    delivered = await db.transaction(async tx => {
      const [fresh] = await tx.select().from(echoUniversesTable).where(scope).for("update").limit(1);
      if (!fresh || fresh.archivedAt || fresh.deletedAt) return false;
      const current = SaveUniverseBody.shape.state.safeParse(fresh.state);
      if (!current.success) return false;
      const target = current.data.messages.find(item => item.id === messageId && item.senderId === characterId &&
        item.recipientId === message.recipientId && item.origin === "autonomy");
      if (!target || target.attachments?.some(item => item.type === "image")) return false;
      const attachment = { id: `camera-${messageId}`, type: "image" as const, url: generated.objectPath, mimeType: generated.mimeType };
      const state = { ...current.data, messages: current.data.messages.map(item =>
        item.id === messageId ? { ...item, attachments: [...(item.attachments ?? []), attachment] } : item) };
      await tx.update(echoUniversesTable).set({ state, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date() }).where(scope);
      return true;
    });
  } finally {
    if (!delivered) await refundCredits(ownerId, messageId).catch(() => undefined);
  }
}
