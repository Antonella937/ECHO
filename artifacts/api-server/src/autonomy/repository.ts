import { and, count, desc, eq, gte, isNull, lt, ne, sql } from "drizzle-orm";
import {
  db,
  echoAutonomyWorkerLeasesTable,
  echoAutonomyCharactersTable,
  echoAutonomyOwnersTable,
  echoAutonomyRunsTable,
  echoUniversesTable,
} from "@workspace/db";
import { DEFAULT_CHARACTER_CONTROL, isAutonomyLiveExecutionEnabled, isAutonomyOwnerAuthorized } from "./constants";

export { DEFAULT_CHARACTER_CONTROL } from "./constants";

export async function readOwnerControls(ownerId: string, universeId = "primary") {
  const [owner] = await db.select().from(echoAutonomyOwnersTable)
    .where(eq(echoAutonomyOwnersTable.ownerId, ownerId)).limit(1);
  const characters = await db.select().from(echoAutonomyCharactersTable)
    .where(and(
      eq(echoAutonomyCharactersTable.ownerId, ownerId),
      eq(echoAutonomyCharactersTable.universeId, universeId),
    ));
  return {
    globalKillSwitchEngaged: owner?.killSwitchEngaged ?? true,
    liveExecutionEnabled: isAutonomyLiveExecutionEnabled() && isAutonomyOwnerAuthorized(ownerId),
    characters: new Map(characters.map((row) => [row.characterId, {
      enabled: row.enabled,
      dmEnabled: row.dmEnabled,
      dmFrequency: (['rarely', 'sometimes', 'frequently'].includes(row.dmFrequency) ? row.dmFrequency : 'sometimes') as 'rarely' | 'sometimes' | 'frequently',
      dmMediaPreference: (['text', 'mixed', 'voice'].includes(row.dmMediaPreference) ? row.dmMediaPreference : 'text') as 'text' | 'mixed' | 'voice',
      dmInstructions: row.dmInstructions,
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

export async function updateCharacterControl(ownerId: string, characterId: string, enabled: boolean, universeId = "primary", lane: "social" | "dm" = "social") {
  await db.insert(echoAutonomyCharactersTable)
    .values({ ownerId, universeId, characterId, ...(lane === "dm" ? { dmEnabled: enabled } : { enabled }) })
    .onConflictDoUpdate({
      target: [
        echoAutonomyCharactersTable.ownerId,
        echoAutonomyCharactersTable.universeId,
        echoAutonomyCharactersTable.characterId,
      ],
      set: { ...(lane === "dm" ? { dmEnabled: enabled } : { enabled }), updatedAt: new Date() },
    });
}

export async function updateDmPreferences(ownerId: string, characterId: string, universeId: string, preferences: { dmFrequency: "rarely" | "sometimes" | "frequently"; dmMediaPreference: "text" | "mixed" | "voice"; dmInstructions: string }) {
  await db.insert(echoAutonomyCharactersTable).values({ ownerId, universeId, characterId, ...preferences })
    .onConflictDoUpdate({ target: [echoAutonomyCharactersTable.ownerId, echoAutonomyCharactersTable.universeId, echoAutonomyCharactersTable.characterId], set: { ...preferences, updatedAt: new Date() } });
}

export async function getExecutedActionHistory(ownerId: string, characterId: string, since: Date, universeId = "primary") {
  return db.select({
    status: echoAutonomyRunsTable.status,
    action: echoAutonomyRunsTable.action,
    situation: echoAutonomyRunsTable.situation,
    targetId: echoAutonomyRunsTable.targetId,
    createdAt: echoAutonomyRunsTable.createdAt,
  }).from(echoAutonomyRunsTable).where(and(
    eq(echoAutonomyRunsTable.ownerId, ownerId),
    eq(echoAutonomyRunsTable.universeId, universeId),
    eq(echoAutonomyRunsTable.characterId, characterId),
    eq(echoAutonomyRunsTable.status, "executed"),
    gte(echoAutonomyRunsTable.createdAt, since),
  )).orderBy(desc(echoAutonomyRunsTable.createdAt));
}

export async function listLiveOptInTargets() {
  const rows = await db.select({
    ownerId: echoAutonomyCharactersTable.ownerId,
    universeId: echoAutonomyCharactersTable.universeId,
    characterId: echoAutonomyCharactersTable.characterId,
    socialEnabled: echoAutonomyCharactersTable.enabled,
    dmEnabled: echoAutonomyCharactersTable.dmEnabled,
  }).from(echoAutonomyCharactersTable).innerJoin(
    echoAutonomyOwnersTable,
    eq(echoAutonomyOwnersTable.ownerId, echoAutonomyCharactersTable.ownerId),
  ).innerJoin(echoUniversesTable, and(
    eq(echoUniversesTable.ownerId, echoAutonomyCharactersTable.ownerId),
    eq(echoUniversesTable.universeId, echoAutonomyCharactersTable.universeId),
  )
  ).where(and(
    sql`(${echoAutonomyCharactersTable.enabled} = true OR ${echoAutonomyCharactersTable.dmEnabled} = true)`,
    eq(echoAutonomyOwnersTable.killSwitchEngaged, false),
    isNull(echoUniversesTable.archivedAt),
    isNull(echoUniversesTable.deletedAt),
  ));
  return rows.filter((row) => isAutonomyOwnerAuthorized(row.ownerId));
}

export async function claimAutonomyWorkerLease(token: string, now = new Date(), ttlMs = 5 * 60_000) {
  const rows = await db.insert(echoAutonomyWorkerLeasesTable).values({
    name: "autonomy-live-worker",
    token,
    expiresAt: new Date(now.getTime() + ttlMs),
    updatedAt: now,
  }).onConflictDoUpdate({
    target: echoAutonomyWorkerLeasesTable.name,
    set: { token, expiresAt: new Date(now.getTime() + ttlMs), updatedAt: now },
    setWhere: lt(echoAutonomyWorkerLeasesTable.expiresAt, now),
  }).returning({ token: echoAutonomyWorkerLeasesTable.token });
  return rows.length === 1 && rows[0]?.token === token;
}

export async function releaseAutonomyWorkerLease(token: string) {
  await db.delete(echoAutonomyWorkerLeasesTable).where(and(
    eq(echoAutonomyWorkerLeasesTable.name, "autonomy-live-worker"),
    eq(echoAutonomyWorkerLeasesTable.token, token),
  ));
}

type Reservation =
  | { kind: "created"; runId: string }
  | { kind: "duplicate"; runId: string; status: string; characterId: string }
  | { kind: "idempotency_conflict"; runId: string; characterId: string }
  | { kind: "rate_limited" };

/** Serialize owner-scoped idempotency reservations and enforce persisted call caps. */
export async function reserveDryRun(
  ownerId: string,
  characterId: string,
  idempotencyKey: string,
  sourceRevision: number,
  universeId = "primary",
  lane: "dm" | "social" = "social",
): Promise<Reservation> {
  return db.transaction(async (tx) => {
    await tx.execute(sql`select pg_advisory_xact_lock(hashtext(${ownerId}), hashtext(${universeId}))`);
    const [existing] = await tx.select({
      id: echoAutonomyRunsTable.id,
      status: echoAutonomyRunsTable.status,
      characterId: echoAutonomyRunsTable.characterId,
      updatedAt: echoAutonomyRunsTable.updatedAt,
      attemptCount: echoAutonomyRunsTable.attemptCount,
    }).from(echoAutonomyRunsTable).where(and(
      eq(echoAutonomyRunsTable.ownerId, ownerId),
      eq(echoAutonomyRunsTable.universeId, universeId),
      eq(echoAutonomyRunsTable.idempotencyKey, idempotencyKey),
    )).limit(1);
    if (existing) {
      if (existing.characterId !== characterId) {
        return { kind: "idempotency_conflict", runId: String(existing.id), characterId: existing.characterId };
      }
      if (existing.status === "running" && Date.now() - existing.updatedAt.getTime() >= 120_000 &&
        existing.attemptCount < 3) {
        const [reclaimed] = await tx.update(echoAutonomyRunsTable).set({
          status: "running", sourceRevision, updatedAt: new Date(),
          attemptCount: existing.attemptCount + 1, lastErrorCode: null,
        }).where(and(
          eq(echoAutonomyRunsTable.ownerId, ownerId),
          eq(echoAutonomyRunsTable.universeId, universeId),
          eq(echoAutonomyRunsTable.id, existing.id),
          eq(echoAutonomyRunsTable.status, "running"),
          lt(echoAutonomyRunsTable.updatedAt, new Date(Date.now() - 120_000)),
        )).returning({ id: echoAutonomyRunsTable.id });
        if (reclaimed) return { kind: "created", runId: String(existing.id) };
      }
      if (existing.status === "running" && Date.now() - existing.updatedAt.getTime() >= 120_000) {
        await tx.update(echoAutonomyRunsTable).set({
          status: "stale_failed", lastErrorCode: "LEASE_EXPIRED", finishedAt: new Date(), updatedAt: new Date(),
        }).where(and(
          eq(echoAutonomyRunsTable.ownerId, ownerId),
          eq(echoAutonomyRunsTable.universeId, universeId),
          eq(echoAutonomyRunsTable.id, existing.id),
          eq(echoAutonomyRunsTable.status, "running"),
        ));
        return { kind: "duplicate", runId: String(existing.id), status: "stale_failed", characterId: existing.characterId };
      }
      return { kind: "duplicate", runId: String(existing.id), status: existing.status, characterId: existing.characterId };
    }

    // DM reservations do not use social activity caps: skip four unnecessary COUNT queries.
    if (lane === "social") {
      const now = new Date();
      const hourAgo = new Date(now.getTime() - 60 * 60_000);
      const dayAgo = new Date(now.getTime() - 24 * 60 * 60_000);
      const [perCharacterHour] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
        eq(echoAutonomyRunsTable.ownerId, ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.characterId, characterId),
        gte(echoAutonomyRunsTable.createdAt, hourAgo),
        eq(echoAutonomyRunsTable.status, "executed"),
        ne(echoAutonomyRunsTable.situation, "dm"),
      ));
      const [ownerHour] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
        eq(echoAutonomyRunsTable.ownerId, ownerId),
        gte(echoAutonomyRunsTable.createdAt, hourAgo),
        eq(echoAutonomyRunsTable.status, "executed"),
        ne(echoAutonomyRunsTable.situation, "dm"),
      ));
      const [perCharacterDay] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
        eq(echoAutonomyRunsTable.ownerId, ownerId),
        eq(echoAutonomyRunsTable.universeId, universeId),
        eq(echoAutonomyRunsTable.characterId, characterId),
        gte(echoAutonomyRunsTable.createdAt, dayAgo),
        eq(echoAutonomyRunsTable.status, "executed"),
        ne(echoAutonomyRunsTable.situation, "dm"),
      ));
      const [ownerDay] = await tx.select({ value: count() }).from(echoAutonomyRunsTable).where(and(
        eq(echoAutonomyRunsTable.ownerId, ownerId),
        gte(echoAutonomyRunsTable.createdAt, dayAgo),
        eq(echoAutonomyRunsTable.status, "executed"),
        ne(echoAutonomyRunsTable.situation, "dm"),
      ));
      if ((perCharacterHour?.value ?? 0) >= 3 || (perCharacterDay?.value ?? 0) >= 10 ||
        (ownerHour?.value ?? 0) >= 3 || (ownerDay?.value ?? 0) >= 12) {
        return { kind: "rate_limited" };
      }
  
    }

    const [created] = await tx.insert(echoAutonomyRunsTable).values({
      ownerId,
      universeId,
      characterId,
      idempotencyKey,
      status: "running",
      sourceRevision,
      attemptCount: 1,
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
    lastErrorCode?: string | null;
  },
  universeId = "primary",
) {
  await db.update(echoAutonomyRunsTable).set({
    status: result.status,
    action: result.action ?? null,
    situation: result.situation ?? null,
    targetId: result.targetId ?? null,
    sourceRevision: result.sourceRevision,
    contextHash: result.contextHash ?? null,
    model: result.model ?? null,
    lastErrorCode: result.lastErrorCode ?? null,
    finishedAt: result.status === "running" ? null : new Date(),
    updatedAt: new Date(),
  }).where(and(
    eq(echoAutonomyRunsTable.ownerId, ownerId),
    eq(echoAutonomyRunsTable.universeId, universeId),
    eq(echoAutonomyRunsTable.id, Number(runId)),
  ));
}
