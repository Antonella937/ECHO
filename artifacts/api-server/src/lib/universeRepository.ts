import { and, eq, isNull, sql } from "drizzle-orm";
import {
  db, echoCreatorEntitlementsTable, echoUniversesTable, echoMemoryArchiveTable,
  type CreatorPlan, type EchoCreatorEntitlement,
} from "@workspace/db";
import { lifetimeAccessForOwner } from "./lifetimeAccess";
import { ECHO_PLAN_CAPACITY, resolveEchoPlan, type EchoPlan } from "./entitlements";
import { displacedMemories } from "./memoryArchive";
import { SaveUniverseBody } from "@workspace/api-zod";
import { DEFAULT_AI_CATEGORY_WEIGHTS, DEFAULT_MONTHLY_HARD_CEILING_UNITS } from "./ai-usage";
import { ensureCharacterPrivacyDefaultsInTransaction } from "./characterPrivacy";
import { removeCharacterSocialRecordsForDeletedCharacters } from "./characterFollows";

export class StructuralLimitError extends Error {
  constructor(readonly code: "UNIVERSE_LIMIT_REACHED" | "CHARACTER_LIMIT_REACHED") { super(code); }
}

export const creatorCapacity = (ownerId: string, plan: EchoPlan, addonCharacters: number, addonUniverses: number) => ({
  // Lifetime founder accounts bypass commercial limits; technical safety ceilings remain.
  maxUniverses: lifetimeAccessForOwner(ownerId) ? 10000 : ECHO_PLAN_CAPACITY[plan].maxUniverses + addonUniverses,
  maxCharacters: lifetimeAccessForOwner(ownerId) ? 100000 : ECHO_PLAN_CAPACITY[plan].maxCharacters + addonCharacters,
});
const asPlan = (value: unknown): CreatorPlan => value === "creator" ? "creator" : "free";

async function lockEntitlement(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ownerId: string, fallbackPlan: CreatorPlan) {
  await tx.insert(echoCreatorEntitlementsTable).values({ ownerId, plan: fallbackPlan }).onConflictDoNothing();
  const [row] = await tx.select().from(echoCreatorEntitlementsTable)
    .where(eq(echoCreatorEntitlementsTable.ownerId, ownerId)).for("update").limit(1);
  return row && lifetimeAccessForOwner(ownerId) ? { ...row, plan: "creator" as const } : row;
}

/** Owner and universe id are always paired; old callers continue to use primary. */
export async function readUniverse(ownerId: string, universeId = "primary") {
  const [row] = await db.select({
    state: echoUniversesTable.state,
    revision: echoUniversesTable.revision,
  }).from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, ownerId),
    eq(echoUniversesTable.universeId, universeId),
    isNull(echoUniversesTable.archivedAt),
    isNull(echoUniversesTable.deletedAt),
  )).limit(1);
  return row ?? { state: null, revision: 0 };
}

/** Atomic compare-and-swap plus owner-wide capacity checks under an entitlement row lock. */
export async function writeUniverse(ownerId: string, state: Record<string, unknown>, expectedRevision: number, universeId = "primary", afterSave?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0]) => Promise<void>) {
  const membershipPlan = await resolveEchoPlan(ownerId);
  return db.transaction(async (tx) => {
    // Only the target universe's creator plan is needed before taking the lock.
    // Avoid downloading every universe's full JSON state twice per save.
    // Read only the existing plan from JSONB; the complete state is loaded
    // later only if required for the target universe's save hooks.
    const [initialCurrent] = await tx.select({
      plan: sql<string | null>`${echoUniversesTable.state}->'creatorSetup'->>'plan'`,
    }).from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId, ownerId),
      eq(echoUniversesTable.universeId, universeId),
    )).limit(1);
    const creatorSetup = state.creatorSetup as { plan?: unknown } | undefined;
    const existingPlan = initialCurrent?.plan;
    const entitlements = await lockEntitlement(
      tx, ownerId,
      asPlan(existingPlan ?? creatorSetup?.plan),
    );
    // Read again after taking the owner entitlement lock so concurrent creates
    // cannot both make a decision from the same stale universe count.
    // Capacity checks need counts, not every universe's entire social JSON.
    // Keep the owner entitlement lock above: concurrent writes must serialize.
    const existingRows = await tx.select({
      universeId: echoUniversesTable.universeId,
      archivedAt: echoUniversesTable.archivedAt,
      deletedAt: echoUniversesTable.deletedAt,
      characterCount: sql<number>`CASE WHEN jsonb_typeof(${echoUniversesTable.state}->'characters') = 'array'
        THEN jsonb_array_length(${echoUniversesTable.state}->'characters') ELSE 0 END`,
    }).from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId));
    const currentMeta = existingRows.find(row => row.universeId === universeId);
    if (currentMeta?.archivedAt || currentMeta?.deletedAt) throw new Error("UNIVERSE_UNAVAILABLE");
    const retainedRows = existingRows.filter(row => !row.deletedAt);
    const caps = creatorCapacity(ownerId, membershipPlan, entitlements.addonCharacters, entitlements.addonUniverses);
    const isNewUniverse = !currentMeta;
    if (isNewUniverse && (expectedRevision !== 0 || retainedRows.length >= caps.maxUniverses))
      throw new StructuralLimitError("UNIVERSE_LIMIT_REACHED");

    const previousCharacters = retainedRows.reduce((total, row) => total + Number(row.characterCount), 0);
    const candidateCharacters = Array.isArray(state.characters) ? state.characters.length : 0;
    const nextCharacters = previousCharacters - (currentMeta && !currentMeta.deletedAt ? Number(currentMeta.characterCount) : 0) + candidateCharacters;
    // Existing over-cap accounts can still edit/delete; only growth is blocked.
    if (nextCharacters > caps.maxCharacters && nextCharacters > previousCharacters)
      throw new StructuralLimitError("CHARACTER_LIMIT_REACHED");

    // The previous full state is needed only for this universe's deletion and
    // memory-diff hooks, not for every universe owned by this user.
    const [current] = currentMeta
      ? await tx.select({ state: echoUniversesTable.state })
        .from(echoUniversesTable).where(and(
          eq(echoUniversesTable.ownerId, ownerId),
          eq(echoUniversesTable.universeId, universeId),
        )).limit(1)
      : [];
    // Canon decisions are server-owned. Ordinary client saves must not erase
    // approved private knowledge or dismissed proposals from their local snapshot.
    const previousSetup = (current?.state?.creatorSetup ?? {}) as Record<string, unknown>;
    const serverCanon = {
      ...(Array.isArray(previousSetup.canonKnowledgeEvents)
        ? { canonKnowledgeEvents: previousSetup.canonKnowledgeEvents } : {}),
      ...(Array.isArray(previousSetup.dismissedCanonEventIds)
        ? { dismissedCanonEventIds: previousSetup.dismissedCanonEventIds } : {}),
    };
    const canonicalState = {
      ...state,
      creatorSetup: {
        ...(creatorSetup ?? {}),
        ...serverCanon,
        plan: entitlements.plan,
      },
    };
    const rows = expectedRevision === 0
      ? await tx.insert(echoUniversesTable)
        .values({ ownerId, universeId, state: canonicalState, revision: 1 })
        .onConflictDoNothing()
        .returning({ state: echoUniversesTable.state, revision: echoUniversesTable.revision })
      : await tx.update(echoUniversesTable)
        .set({ state: canonicalState, revision: sql`${echoUniversesTable.revision} + 1`, updatedAt: new Date() })
        .where(and(
          eq(echoUniversesTable.ownerId, ownerId),
          eq(echoUniversesTable.universeId, universeId),
          eq(echoUniversesTable.revision, expectedRevision),
        ))
        .returning({ state: echoUniversesTable.state, revision: echoUniversesTable.revision });
    const saved = rows[0] ?? null;
    if (saved) {
      if (current) {
        await removeCharacterSocialRecordsForDeletedCharacters(
          tx,
          ownerId,
          universeId,
          current.state,
          canonicalState,
        );
      }
      // Opt-in only after the archive table migration is deployed. Keep writes
      // in the same transaction so a failed revision never archives anything.
      if (current && process.env.ECHO_MEMORY_ARCHIVE_ENABLED === "true") {
        const before = SaveUniverseBody.shape.state.safeParse(current.state);
        const after = SaveUniverseBody.shape.state.safeParse(canonicalState);
        if (before.success && after.success) {
          const events = displacedMemories(before.data, after.data);
          if (events.length) await tx.insert(echoMemoryArchiveTable)
            .values(events.map(event => ({ ownerId, universeId, ...event })))
            .onConflictDoNothing();
        }
      }
      await ensureCharacterPrivacyDefaultsInTransaction(tx, ownerId, universeId, canonicalState);
      if (afterSave) await afterSave(tx);
    }
    return saved;
  });
}

export async function createAdditionalUniverse(ownerId: string, name: string, state: Record<string, unknown>, afterCreate?: (tx: Parameters<Parameters<typeof db.transaction>[0]>[0], universeId: string) => Promise<void>) {
  const membershipPlan = await resolveEchoPlan(ownerId);
  return db.transaction(async (tx) => {
    const creatorSetup = state.creatorSetup as { plan?: unknown } | undefined;
    const entitlements = await lockEntitlement(tx, ownerId, asPlan(creatorSetup?.plan));
    // Serialize capacity checks by owner before reading the current counts.
    const rows = await tx.select({
      characterCount: sql<number>`CASE WHEN jsonb_typeof(${echoUniversesTable.state}->'characters') = 'array'
        THEN jsonb_array_length(${echoUniversesTable.state}->'characters') ELSE 0 END`,
    }).from(echoUniversesTable).where(and(
      eq(echoUniversesTable.ownerId, ownerId),
      isNull(echoUniversesTable.deletedAt),
    ));
    const caps = creatorCapacity(ownerId, membershipPlan, entitlements.addonCharacters, entitlements.addonUniverses);
    if (rows.length >= caps.maxUniverses) throw new StructuralLimitError("UNIVERSE_LIMIT_REACHED");
    const characterCount = rows.reduce((total, row) => total + Number(row.characterCount), 0);
    const newCharacterCount = Array.isArray(state.characters) ? state.characters.length : 0;
    if (characterCount + newCharacterCount > caps.maxCharacters)
      throw new StructuralLimitError("CHARACTER_LIMIT_REACHED");
    const universeId = crypto.randomUUID();
    const canonicalState = {
      ...state,
      creatorSetup: {
        plan: entitlements.plan,
        universeName: name.trim(),
        completedAt: new Date().toISOString(),
      },
    };
    const saved = await tx.insert(echoUniversesTable).values({
      ownerId, universeId, revision: 1, state: canonicalState,
    }).onConflictDoNothing().returning({ state: echoUniversesTable.state, revision: echoUniversesTable.revision });
    if (!saved[0]) throw new Error("UNIVERSE_CREATE_CONFLICT");
    await ensureCharacterPrivacyDefaultsInTransaction(tx, ownerId, universeId, canonicalState);
    if (afterCreate) await afterCreate(tx, universeId);
    await tx.update(echoCreatorEntitlementsTable)
      .set({ updatedAt: new Date() }).where(eq(echoCreatorEntitlementsTable.ownerId, ownerId));
    return { universeId, ...saved[0] };
  });
}

export async function listUniverses(ownerId: string) {
  return db.select({
    universeId: echoUniversesTable.universeId,
    state: echoUniversesTable.state,
    revision: echoUniversesTable.revision,
    archivedAt: echoUniversesTable.archivedAt,
    updatedAt: echoUniversesTable.updatedAt,
  }).from(echoUniversesTable).where(and(eq(echoUniversesTable.ownerId, ownerId), isNull(echoUniversesTable.deletedAt)));
}

export async function creatorEntitlements(ownerId: string) {
  const [saved] = await db.select().from(echoCreatorEntitlementsTable)
    .where(eq(echoCreatorEntitlementsTable.ownerId, ownerId)).limit(1);
  if (saved) return lifetimeAccessForOwner(ownerId) ? { ...saved, plan: "creator" as const } : saved;
  // Entitlement fallback needs the legacy plan only, not the universe JSON.
  const [primary] = await db.select({
    plan: sql<string | null>`${echoUniversesTable.state}->'creatorSetup'->>'plan'`,
  }).from(echoUniversesTable)
    .where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, "primary"))).limit(1);
  if (!primary) return {
    ownerId, plan: lifetimeAccessForOwner(ownerId) ? "creator" as const : "free" as const, addonCharacters: 0, addonUniverses: 0,
    monthlyHardCeilingUnits: DEFAULT_MONTHLY_HARD_CEILING_UNITS, autonomyReservePercent: 20,
    categoryWeights: DEFAULT_AI_CATEGORY_WEIGHTS,
    createdAt: new Date(0), updatedAt: new Date(0),
  } satisfies EchoCreatorEntitlement;
  return db.transaction(tx => lockEntitlement(tx, ownerId, asPlan(primary.plan)));
}
