import { and, count, desc, eq, gte, sql } from "drizzle-orm";
import {
  db,
  echoAutonomyCharactersTable,
  echoAutonomyOwnersTable,
  echoAutonomyRunsTable,
} from "@workspace/db";
import { DEFAULT_CHARACTER_CONTROL } from "./constants";

export { DEFAULT_CHARACTER_CONTROL } from "./constants";

export async function readOwnerControls(ownerId: string) {
  const [owner] = await db.select().from(echoAutonomyOwnersTable)
    .where(eq(echoAutonomyOwnersTable.ownerId, ownerId)).limit(1);
  const characters = await db.select().from(echoAutonomyCharactersTable)
    .where(eq(echoAutonomyCharactersTable.ownerId, ownerId));
  return {
    globalKillSwitchEngaged: owner?.killSwitchEngaged ?? true,
    liveExecutionEnabled: false as const,
    characters: new Map(characters.map((row) => [row.characterId, {
      enabled: row.enabled,
      maxActionsPerDay: Math.max(1, Math.min(4, row.maxActionsPerDay)),
      minCooldownMinutes: Math.max(60, Math.min(1440, row.minCooldownMinutes)),
    }])),
  };
}

export async function updateOwnerKillSwitch(ownerId: string, engaged: boolean) {
  await db.insert(echoAutonomyOwnersTable)
    .values({ ownerId, killSwitchEngaged: engaged })
    .onConflictDoUpdate({
      target: echoAutonomyOwnersTable.ownerId,
      set: { killSwitchEngaged: engaged, updatedAt: new Date() },
    });
}

export async function updateCharacterControl(ownerId: string, characterId: string, enabled: boolean) {
  await db.insert(echoAutonomyCharactersTable)
    .values({ ownerId, characterId, enabled })
    .onConflictDoUpdate({
      target: [echoAutonomyCharactersTable.ownerId, echoAutonomyCharactersTable.characterId],
      set: { enabled, updatedAt: new Date() },
    });
}

export async function getExecutedActionHistory(ownerId: string, characterId: string, since: Date) {
  return db.select({
    status: echoAutonomyRunsTable.status,
    action: echoAutonomyRunsTable.action,
    situation: echoAutonomyRunsTable.situation,
    targetId: echoAutonomyRunsTable.targetId,
    createdAt: echoAutonomyRunsTable.createdAt,
  }).from(echoAutonomyRunsTable).where(and(
    eq(echoAutonomyRunsTable.ownerId, ownerId),
    eq(echoAutonomyRunsTable.characterId, characterId),
    eq(echoAutonomyRunsTable.status, "executed"),
    gte(echoAutonomyRunsTable.createdAt, since),
  )).orderBy(desc(echoAutonomyRunsTable.createdAt));
}

type Reservation =
  | { kind: "created"; runId: string }
  | { kind: "duplicate"; runId: string; status: string; characterId: string }
  | { kind: "idempotency_conflict"; runId: string; characterId: string }
  | { kind: "rate_limited" };

/** Serialize owner-scoped idempotency reservations and enforce persisted call caps. */
export async function reserveDryRun(ownerId: string, characterId: string, idempotencyKey: string, sourceRevision: number): Promise<Reservation> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}), 0)`);
    const [existing] = await tx.select({
      id: echoAutonomyRunsTable.id,
      status: echoAutonomyRunsTable.status,
      characterId: echoAutonomyRunsTable.characterId,
      createdAt: echoAutonomyRunsTable.createdAt,
    }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, ownerId),
      eq(echoAutonomyRunsTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (existing.characterId !== characterId) {
        return { kind: "idempotency_conflict", runId: String(existing.id), characterId: existing.characterId };
      }
      if (existing.status === "running" && Date.now() - existing.createdAt.getTime() >= 120_000) {
        await tx.update(echoAutonomyRunsTable).set({
          status: "running", sourceRevision, updatedAt: new Date(),
        }).where(eq(echoAutonomyRunsTable.id, existing.id));
        return { kind: "created", runId: String(existing.id) };
      }
      return { kind: "duplicate", runId: String(existing.id), status: existing.status, characterId: existing.characterId };
    }

    const now = new Date();
    const hourAgo = new Date(now.getTime() - 60 * 60_000);
    const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
    const [perCharacterHour] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, ownerId),
      eq(echoAutonomyRunsTable.characterId, characterId),
      gte(echoAutonomyRunsTable.createdAt, hourAgo),
    ));
    const [ownerHour] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, ownerId),
      gte(echoAutonomyRunsTable.createdAt, hourAgo),
    ));
    const [perCharacterDay] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, ownerId),
      eq(echoAutonomyRunsTable.characterId, characterId),
      gte(echoAutonomyRunsTable.createdAt, dayAgo),
    ));
    const [ownerDay] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, ownerId),
      gte(echoAutonomyRunsTable.createdAt, dayAgo),
    ));
    if ((perCharacterHour?.value ?? 0) >= 3 || (perCharacterDay?.value ?? 0) >= 10 ||
      (ownerHour?.value ?? 0) >= 3 || (ownerDay?.value ?? 0) >= 12) {
      return { kind: "rate_limited" };
    }

    const [created] = await tx.insert(echoAutonomyRunsTable).values({
      ownerId,
      characterId,
      idempotencyKey,
      status: "running",
      sourceRevision,
    }).returning({ id: echoAutonomyRunsTable.id });
    return { kind: "created", runId: String(created.id) };
  });
}

export async function completeDryRun(
  ownerId: string,
  runId: string,
  result: {
    status: string;
    action?: string | null;
    situation?: string | null;
    targetId?: string | null;
    sourceRevision?: number;
    contextHash?: string | null;
    model?: string | null;
  },
) {
  await db.update(echoAutonomyRunsTable).set({
    status: result.status,
    action: result.action ?? null,
    situation: result.situation ?? null,
    targetId: result.targetId ?? null,
    sourceRevision: result.sourceRevision,
    contextHash: result.contextHash ?? null,
    model: result.model ?? null,
    updatedAt: new Date(),
  }).where(and(
    eq(echoAutonomyRunsTable.ownerId, ownerId),
    eq(echoAutonomyRunsTable.id, Number(runId)),
  ));
}
