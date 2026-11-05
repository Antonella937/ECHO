import { and, eq, sql } from "drizzle-orm";
import { db, echoRelationshipLedgerTable, echoUniversesTable } from "@workspace/db";
import { SaveUniverseBody } from "@workspace/api-zod";
import { applyApprovedClosenessProgression } from "./relationshipProgression";

/** One explicit owner-authorized request. All reads and writes share a DB transaction. */
export async function approveRelationshipProgression(
  ownerId: string, universeId: string, actorId: string, targetId: string,
  expectedRevision: number,
): Promise<{ applied: boolean; reason: string; revision: number | null }> {
  return db.transaction(async tx => {
    const scope = and(
      eq(echoUniversesTable.ownerId, ownerId),
      eq(echoUniversesTable.universeId, universeId),
    );
    // Lock the universe before examining the evidence, so concurrent requests
    // cannot both approve the same messages.
    const [universe] = await tx.select().from(echoUniversesTable)
      .where(scope).for("update").limit(1);
    if (!universe || universe.archivedAt || universe.deletedAt)
      return { applied: false, reason: "UNIVERSE_UNAVAILABLE", revision: null };
    if (universe.revision !== expectedRevision)
      return { applied: false, reason: "REVISION_CONFLICT", revision: universe.revision };

    const parsed = SaveUniverseBody.shape.state.safeParse(universe.state);
    if (!parsed.success)
      return { applied: false, reason: "INVALID_SAVED_STATE", revision: universe.revision };

    const ledgerScope = and(
      eq(echoRelationshipLedgerTable.ownerId, ownerId),
      eq(echoRelationshipLedgerTable.universeId, universeId),
      eq(echoRelationshipLedgerTable.actorId, actorId),
      eq(echoRelationshipLedgerTable.targetId, targetId),
    );
    const [ledger] = await tx.select().from(echoRelationshipLedgerTable)
      .where(ledgerScope).for("update").limit(1);
    const now = new Date();
    const consumed = ledger?.consumedMessageIds ?? [];
    const result = applyApprovedClosenessProgression(
      parsed.data, actorId, targetId, now,
      { lastAppliedAt: ledger?.lastAppliedAt ?? null, consumedMessageIds: consumed },
    );
    if (!result.applied)
      return { applied: false, reason: result.reason, revision: universe.revision };

    const cutoff = now.getTime() - 30 * 24 * 60 * 60_000;
    const usedIds = parsed.data.messages.filter(message => {
      const time = new Date(message.createdAt).getTime();
      return !consumed.includes(message.id) &&
        !message.hiddenForIds?.includes(actorId) &&
        Number.isFinite(time) && time >= cutoff && time <= now.getTime() &&
        ((message.senderId === actorId && message.recipientId === targetId) ||
          (message.senderId === targetId && message.recipientId === actorId));
    }).map(message => message.id);
    const updated = await tx.update(echoUniversesTable)
      .set({ state: { ...result.state }, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: now })
      .where(and(scope, eq(echoUniversesTable.revision, expectedRevision)))
      .returning({ revision: echoUniversesTable.revision });
    if (!updated[0]) throw new Error("RELATIONSHIP_REVISION_RACE");
    await tx.insert(echoRelationshipLedgerTable).values({
      ownerId, universeId, actorId, targetId,
      lastAppliedAt: now, appliedCount: 1,
      consumedMessageIds: [...new Set([...consumed, ...usedIds])],
    }).onConflictDoUpdate({
      target: [
        echoRelationshipLedgerTable.ownerId, echoRelationshipLedgerTable.universeId,
        echoRelationshipLedgerTable.actorId, echoRelationshipLedgerTable.targetId,
      ],
      set: {
        lastAppliedAt: now,
        appliedCount: sql`${echoRelationshipLedgerTable.appliedCount} + 1`,
        consumedMessageIds: [...new Set([...consumed, ...usedIds])],
      },
    });
    return { applied: true, reason: result.reason, revision: updated[0].revision };
  });
}
