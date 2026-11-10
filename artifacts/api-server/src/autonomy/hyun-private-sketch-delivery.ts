import { and, eq, sql } from "drizzle-orm";
import { db, echoUniversesTable } from "@workspace/db";
import { SaveUniverseBody } from "@workspace/api-zod";
import { generateCharacterImage } from "../lib/imageGenerationService";
import { buildHyunPrivateSketchPrompt, canAttemptHyunPrivateSketch } from "./hyun-private-sketch-policy";

/** Disabled by default; attaches to an existing private DM only. */
export async function dispatchHyunPrivateSketch(input: {
  ownerId: string; universeId: string; characterId: string;
  recipientId: string; messageId: string; subject: string;
}): Promise<"attached" | "skipped"> {
  if (process.env.ECHO_HYUN_AUTONOMOUS_SKETCH_ENABLED !== "true") return "skipped";
  const where = and(eq(echoUniversesTable.ownerId, input.ownerId),
    eq(echoUniversesTable.universeId, input.universeId));
  const [universe] = await db.select().from(echoUniversesTable).where(where).limit(1);
  if (!universe || universe.archivedAt || universe.deletedAt) return "skipped";
  const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
  if (!parsed.success) return "skipped";
  const sender = parsed.data.characters.find(c => c.id === input.characterId && !c.archived);
  const recipient = parsed.data.characters.find(c => c.id === input.recipientId && !c.archived);
  const handle = (c: typeof sender) => {
    const record = c as unknown as Record<string, unknown> | undefined;
    return typeof record?.handle === "string" ? record.handle :
      typeof record?.username === "string" ? record.username : "";
  };
  // The recipient must be the currently selected human-controlled identity.
  // A matching handle alone must never authorize a paid delivery to another AI.
  if (recipient?.id !== parsed.data.currentCharacterId) return "skipped";
  if (!sender || !recipient || !canAttemptHyunPrivateSketch({
    ownerId: input.ownerId, senderHandle: handle(sender),
    recipientHandle: handle(recipient), channel: "dm", explicitlyEnabled: true,
  })) return "skipped";
  if (!parsed.data.messages.some(m => m.id === input.messageId &&
    m.senderId === sender.id && m.recipientId === recipient.id &&
    m.origin === "autonomy" && !m.attachments?.some(a => a.type === "image"))) return "skipped";
  // The provider is never called before the atomic budget reservation.
  const generated = await generateCharacterImage({
    ownerId: input.ownerId, universeId: input.universeId,
    characterId: sender.id, preparedPrompt: buildHyunPrivateSketchPrompt(input.subject),
    style: "phone", referencePaths: [], purpose: "hyun_private_sketch",
  });
  return db.transaction(async tx => {
    const [fresh] = await tx.select().from(echoUniversesTable).where(where).for("update").limit(1);
    if (!fresh || fresh.archivedAt || fresh.deletedAt) return "skipped";
    const validated = SaveUniverseBody.shape.state.safeParse(fresh.state);
    if (!validated.success) return "skipped";
    const message = validated.data.messages.find(m => m.id === input.messageId &&
      m.senderId === sender.id && m.recipientId === recipient.id &&
      m.origin === "autonomy" && !m.attachments?.some(a => a.type === "image"));
    if (!message || validated.data.currentCharacterId !== recipient.id) return "skipped";
    const state = { ...validated.data, messages: validated.data.messages.map(m =>
      m.id === message.id ? { ...m, attachments: [...(m.attachments ?? []), {
        id: `hyun-sketch-${message.id}`, type: "image" as const,
        url: generated.objectPath, mimeType: generated.mimeType,
      }] } : m) };
    await tx.update(echoUniversesTable).set({
      state, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date(),
    }).where(where);
    return "attached";
  });
}
