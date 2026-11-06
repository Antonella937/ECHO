import { and, eq, sql } from "drizzle-orm";
import { db, echoRelationshipLedgerTable, echoUniversesTable } from "@workspace/db";
import { SaveUniverseBody } from "@workspace/api-zod";
import { applyVerifiedTrustEvent, type TrustEventKind } from "./relationshipTrust";

/**
 * Owner-approved trust changes anchored to an actual persisted DM.
 * The owner, not an LLM, confirms the event's meaning. No autonomous
 * inference is permitted. Reuse the durable relationship ledger with a
 * namespaced ID to avoid consuming evidence used for closeness progression.
 */
export async function approveTrustEvent(
  ownerId: string, universeId: string, actorId: string, targetId: string,
  sourceId: string, kind: TrustEventKind, expectedRevision: number,
): Promise<{ applied: boolean; reason: string; revision: number | null; delta: number }> {
  return db.transaction(async tx => {
    const scope = and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, universeId));
    const [universe] = await tx.select().from(echoUniversesTable).where(scope).for("update").limit(1);
    const reject = (reason: string, revision: number | null = universe?.revision ?? null) =>
      ({ applied: false, reason, revision, delta: 0 });
    if (!universe || universe.archivedAt || universe.deletedAt) return reject("UNIVERSE_UNAVAILABLE");
    if (universe.revision !== expectedRevision) return reject("REVISION_CONFLICT");
    const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
    if (!parsed.success) return reject("INVALID_SAVED_STATE");
    const message = parsed.data.messages.find(m => m.id === sourceId &&
      !m.hiddenForIds?.includes(actorId) &&
      ((m.senderId === actorId && m.recipientId === targetId) ||
       (m.senderId === targetId && m.recipientId === actorId)));
    if (!message) return reject("SOURCE_MESSAGE_NOT_FOUND");
    const ledgerScope = and(
      eq(echoRelationshipLedgerTable.ownerId, ownerId),
      eq(echoRelationshipLedgerTable.universeId, universeId),
      eq(echoRelationshipLedgerTable.actorId, actorId),
      eq(echoRelationshipLedgerTable.targetId, targetId),
    );
    const [ledger] = await tx.select().from(echoRelationshipLedgerTable).where(ledgerScope).for("update").limit(1);
    const consumed = ledger?.consumedMessageIds ?? [];
    const key = `trust:${sourceId}`;
    const result = applyVerifiedTrustEvent(parsed.data, {
      sourceId: key, actorId, targetId, kind, occurredAt: new Date(message.createdAt), verified: true,
    }, { consumedSourceIds: consumed }, new Date());
    if (!result.applied) return reject(result.reason);
    const now = new Date();
    const updated = await tx.update(echoUniversesTable)
      .set({ state: { ...result.state }, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: now })
      .where(and(scope, eq(echoUniversesTable.revision, expectedRevision)))
      .returning({ revision: echoUniversesTable.revision });
    if (!updated[0]) throw new Error("TRUST_REVISION_RACE");
    await tx.insert(echoRelationshipLedgerTable).values({
      ownerId, universeId, actorId, targetId,
      lastAppliedAt: ledger?.lastAppliedAt ?? now,
      appliedCount: ledger?.appliedCount ?? 0,
      consumedMessageIds: [...consumed, key],
    }).onConflictDoUpdate({
      target: [
        echoRelationshipLedgerTable.ownerId, echoRelationshipLedgerTable.universeId,
        echoRelationshipLedgerTable.actorId, echoRelationshipLedgerTable.targetId,
      ],
      set: { consumedMessageIds: [...consumed, key] },
    });
    return { applied: true, reason: result.reason, revision: updated[0].revision, delta: result.delta };
  });
}
