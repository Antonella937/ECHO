import { and, eq, sql } from "drizzle-orm";
import {
  db, echoCreatorEntitlementsTable, echoUniversesTable,
  type CreatorPlan, type EchoCreatorEntitlement,
} from "@workspace/db";
import { DEFAULT_AI_CATEGORY_WEIGHTS, DEFAULT_MONTHLY_HARD_CEILING_UNITS } from "./ai-usage";
import { ensureCharacterPrivacyDefaultsInTransaction } from "./characterPrivacy";
import { removeCharacterSocialRecordsForDeletedCharacters } from "./characterFollows";

export class StructuralLimitError extends Error {
  constructor(readonly code: "UNIVERSE_LIMIT_REACHED" | "CHARACTER_LIMIT_REACHED") { super(code); }
}

const planCaps = (plan: CreatorPlan, addonCharacters: number, addonUniverses: number) => ({
  maxUniverses: (plan === "creator" ? 5 : 1) + addonUniverses,
  maxCharacters: (plan === "creator" ? 25 : 5) + addonCharacters,
});
const asPlan = (value: unknown): CreatorPlan => value === "creator" ? "creator" : "free";

async function lockEntitlement(tx: Parameters<Parameters<typeof db.transaction>[0]>[0], ownerId: string, fallbackPlan: CreatorPlan) {
  await tx.insert(echoCreatorEntitlementsTable).values({ ownerId, plan: fallbackPlan }).onConflictDoNothing();
  const [row] = await tx.select().from(echoCreatorEntitlementsTable)
    .where(eq(echoCreatorEntitlementsTable.ownerId, ownerId)).for("update").limit(1);
  return row;
}

/** Owner and universe id are always paired; old callers continue to use primary. */
export async function readUniverse(ownerId: string, universeId = "primary") {
  const [row] = await db.select({
    state: echoUniversesTable.state,
    revision: echoUniversesTable.revision,
  }).from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, ownerId),
    eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  return row ?? { state: null, revision: 0 };
}

/** Atomic compare-and-swap plus owner-wide capacity checks under an entitlement row lock. */
export async function writeUniverse(ownerId: string, state: Record<string, unknown>, expectedRevision: number, universeId = "primary") {
  return db.transaction(async (tx) => {
    const initialRows = await tx.select().from(echoUniversesTable)
      .where(eq(echoUniversesTable.ownerId, ownerId));
    const initialCurrent = initialRows.find(row => row.universeId === universeId);
    const creatorSetup = state.creatorSetup as { plan?: unknown } | undefined;
    const existingPlan = initialCurrent?.state?.creatorSetup as { plan?: unknown } | undefined;
    const entitlements = await lockEntitlement(
      tx, ownerId,
      asPlan(existingPlan?.plan ?? creatorSetup?.plan),
    );
    // Read again after taking the owner entitlement lock so concurrent creates
    // cannot both make a decision from the same stale universe count.
    const existingRows = await tx.select().from(echoUniversesTable)
      .where(eq(echoUniversesTable.ownerId, ownerId));
    const current = existingRows.find(row => row.universeId === universeId);
    const caps = planCaps(entitlements.plan, entitlements.addonCharacters, entitlements.addonUniverses);
    const isNewUniverse = !current;
    if (isNewUniverse && (expectedRevision !== 0 || existingRows.length >= caps.maxUniverses))
      throw new StructuralLimitError("UNIVERSE_LIMIT_REACHED");

    const previousCharacters = existingRows.reduce((total, row) => {
      const value = row.state.characters;
      return total + (Array.isArray(value) ? value.length : 0);
    }, 0);
    const candidateCharacters = Array.isArray(state.characters) ? state.characters.length : 0;
    const nextCharacters = previousCharacters - (current && Array.isArray(current.state.characters) ? current.state.characters.length : 0) + candidateCharacters;
    // Existing over-cap accounts can still edit/delete; only growth is blocked.
    if (nextCharacters > caps.maxCharacters && nextCharacters > previousCharacters)
      throw new StructuralLimitError("CHARACTER_LIMIT_REACHED");

    const canonicalState = creatorSetup
      ? { ...state, creatorSetup: { ...creatorSetup, plan: entitlements.plan } }
      : state;
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
      await ensureCharacterPrivacyDefaultsInTransaction(tx, ownerId, universeId, canonicalState);
    }
    return saved;
  });
}

export async function createAdditionalUniverse(ownerId: string, name: string, state: Record<string, unknown>) {
  return db.transaction(async (tx) => {
    const creatorSetup = state.creatorSetup as { plan?: unknown } | undefined;
    const entitlements = await lockEntitlement(tx, ownerId, asPlan(creatorSetup?.plan));
    // Serialize capacity checks by owner before reading the current counts.
    const rows = await tx.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId));
    const caps = planCaps(entitlements.plan, entitlements.addonCharacters, entitlements.addonUniverses);
    if (rows.length >= caps.maxUniverses) throw new StructuralLimitError("UNIVERSE_LIMIT_REACHED");
    const characterCount = rows.reduce((total, row) => {
      const characters = row.state.characters;
      return total + (Array.isArray(characters) ? characters.length : 0);
    }, 0);
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
    updatedAt: echoUniversesTable.updatedAt,
  }).from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId));
}

export async function creatorEntitlements(ownerId: string) {
  const [saved] = await db.select().from(echoCreatorEntitlementsTable)
    .where(eq(echoCreatorEntitlementsTable.ownerId, ownerId)).limit(1);
  if (saved) return saved;
  const [primary] = await db.select({ state: echoUniversesTable.state }).from(echoUniversesTable)
    .where(and(eq(echoUniversesTable.ownerId, ownerId), eq(echoUniversesTable.universeId, "primary"))).limit(1);
  if (!primary) return {
    ownerId, plan: "free" as const, addonCharacters: 0, addonUniverses: 0,
    monthlyHardCeilingUnits: DEFAULT_MONTHLY_HARD_CEILING_UNITS, autonomyReservePercent: 20,
    categoryWeights: DEFAULT_AI_CATEGORY_WEIGHTS,
    createdAt: new Date(0), updatedAt: new Date(0),
  } satisfies EchoCreatorEntitlement;
  const setup = primary?.state?.creatorSetup as { plan?: unknown } | undefined;
  return db.transaction(tx => lockEntitlement(tx, ownerId, asPlan(setup?.plan)));
}
