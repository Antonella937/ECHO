import { and, eq, sql } from "drizzle-orm";
import { db, echoUniversesTable } from "@workspace/db";

/** Atomic compare-and-swap: a stale device can never replace a newer revision. */
export async function readUniverse(ownerId: string) {
  const [row] = await db.select({
    state: echoUniversesTable.state,
    revision: echoUniversesTable.revision,
  }).from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId)).limit(1);
  return row ?? { state: null, revision: 0 };
}

export async function writeUniverse(ownerId: string, state: Record<string, unknown>, expectedRevision: number) {
  const rows = expectedRevision === 0
    ? await db.insert(echoUniversesTable)
      .values({ ownerId, state, revision: 1 })
      .onConflictDoNothing()
      .returning({ state: echoUniversesTable.state, revision: echoUniversesTable.revision })
    : await db.update(echoUniversesTable)
      .set({ state, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date() })
      .where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.revision, expectedRevision)))
      .returning({ state: echoUniversesTable.state, revision: echoUniversesTable.revision });
  return rows[0] ?? null;
}
