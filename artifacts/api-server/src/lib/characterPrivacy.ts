import { and, eq } from "drizzle-orm";
import { readableUniverseFilter } from "./socialContentAccess";
import {
  db,
  echoCharacterPrivacyTable,
  echoUniversesTable,
  type CharacterVisibility,
} from "@workspace/db";

type PrivacyTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

function characterIdsFromState(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const characters = (state as { characters?: unknown }).characters;
  if (!Array.isArray(characters)) return [];
  return [...new Set(characters.flatMap((character) =>
    character && typeof character === "object" &&
    typeof (character as { id?: unknown }).id === "string" &&
    (character as { id: string }).id.length > 0
      ? [(character as { id: string }).id]
      : [],
  ))];
}

/** Idempotently materializes the public default for every current character. */
export async function ensureCharacterPrivacyDefaultsInTransaction(
  tx: PrivacyTransaction,
  ownerId: string,
  universeId: string,
  state: unknown,
): Promise<void> {
  const characterIds = characterIdsFromState(state);
  if (characterIds.length === 0) return;
  await tx.insert(echoCharacterPrivacyTable).values(characterIds.map((characterId) => ({
    ownerId,
    universeId,
    characterId,
    visibility: "public" as const,
  }))).onConflictDoNothing();
}

async function lockOwnedCharacter(
  tx: PrivacyTransaction,
  ownerId: string,
  universeId: string,
  characterId: string,
) {
  const [universe] = await tx.select({ state: echoUniversesTable.state })
    .from(echoUniversesTable)
    .where(and(
      eq(echoUniversesTable.ownerId, ownerId),
      eq(echoUniversesTable.universeId, universeId),
      readableUniverseFilter(),
    ))
    .for("update")
    .limit(1);
  if (!universe || !characterIdsFromState(universe.state).includes(characterId)) return null;
  await ensureCharacterPrivacyDefaultsInTransaction(tx, ownerId, universeId, universe.state);
  return universe;
}

/**
 * Returns null for a missing/foreign universe or character so the API can use
 * one non-enumerating 404 response for both cases.
 */
export async function getCharacterVisibility(
  ownerId: string,
  universeId: string,
  characterId: string,
): Promise<CharacterVisibility | null> {
  return db.transaction(async (tx) => {
    const universe = await lockOwnedCharacter(tx, ownerId, universeId, characterId);
    if (!universe) return null;
    const [row] = await tx.select({ visibility: echoCharacterPrivacyTable.visibility })
      .from(echoCharacterPrivacyTable)
      .where(and(
        eq(echoCharacterPrivacyTable.ownerId, ownerId),
        eq(echoCharacterPrivacyTable.universeId, universeId),
        eq(echoCharacterPrivacyTable.characterId, characterId),
      ))
      .limit(1);
    return row?.visibility ?? "public";
  });
}

export async function setCharacterVisibility(
  ownerId: string,
  universeId: string,
  characterId: string,
  visibility: CharacterVisibility,
): Promise<CharacterVisibility | null> {
  return db.transaction(async (tx) => {
    const universe = await lockOwnedCharacter(tx, ownerId, universeId, characterId);
    if (!universe) return null;
    const [row] = await tx.insert(echoCharacterPrivacyTable).values({
      ownerId,
      universeId,
      characterId,
      visibility,
      updatedAt: new Date(),
    }).onConflictDoUpdate({
      target: [
        echoCharacterPrivacyTable.ownerId,
        echoCharacterPrivacyTable.universeId,
        echoCharacterPrivacyTable.characterId,
      ],
      set: { visibility, updatedAt: new Date() },
    }).returning({ visibility: echoCharacterPrivacyTable.visibility });
    return row?.visibility ?? null;
  });
}
