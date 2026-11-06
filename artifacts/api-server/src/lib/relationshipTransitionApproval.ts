import { and, eq, sql } from "drizzle-orm";
import { db, echoMemoryArchiveTable, echoUniversesTable } from "@workspace/db";
import { SaveUniverseBody } from "@workspace/api-zod";
import { recordAutonomyEvent } from "../autonomy/event-memory";
import { applyApprovedRelationshipTransition, type RelationshipPreset } from "./relationshipTransitions";

export async function approveRelationshipTransition(
  ownerId: string, universeId: string, actorId: string, targetId: string,
  from: RelationshipPreset, to: RelationshipPreset, expectedRevision: number,
): Promise<{ applied: boolean; reason: string; revision: number | null }> {
  return db.transaction(async tx => {
    const scope = and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId));
    const [universe] = await tx.select().from(echoUniversesTable).where(scope).for("update").limit(1);
    const reject = (reason: string) => ({ applied: false, reason, revision: universe?.revision ?? null });
    if (!universe || universe.archivedAt || universe.deletedAt) return reject("UNIVERSE_UNAVAILABLE");
    if (universe.revision !== expectedRevision) return reject("REVISION_CONFLICT");
    const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
    if (!parsed.success) return reject("INVALID_SAVED_STATE");
    const result = applyApprovedRelationshipTransition(parsed.data, actorId, targetId, from, to);
    if (!result.applied) return reject(result.reason);
    const now = new Date();
    const actorName = parsed.data.characters.find(c => c.id === actorId)?.name ?? actorId;
    const targetName = parsed.data.characters.find(c => c.id === targetId)?.name ?? targetId;
    const summary = `Transición confirmada por el propietario: vínculo de ${actorName} hacia ${targetName} cambió de ${from} a ${to}. Los demás indicadores permanecen iguales.`;
    const sourceId = `transition:${actorId}:${targetId}:${expectedRevision}`;
    const withMemory = recordAutonomyEvent(result.state, actorId, {
      sourceId, kind: "interaction", text: summary, targetId,
    }, now);
    const updated = await tx.update(echoUniversesTable)
      .set({ state: { ...withMemory }, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: now })
      .where(and(scope, eq(echoUniversesTable.revision, expectedRevision)))
      .returning({ revision: echoUniversesTable.revision });
    if (!updated[0]) throw new Error("TRANSITION_REVISION_RACE");
    await tx.insert(echoMemoryArchiveTable).values({
      ownerId, universeId, characterId: actorId, targetId, sourceId,
      memoryId: sourceId, kind: "relationship_transition", content: summary, occurredAt: now,
    }).onConflictDoNothing();
    return { applied: true, reason: result.reason, revision: updated[0].revision };
  });
}
