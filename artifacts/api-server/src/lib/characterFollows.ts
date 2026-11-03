import { and, desc, eq, inArray, or } from "drizzle-orm";
import { readableUniverseFilter } from "./socialContentAccess";
import {
  db,
  echoCharacterFollowRequestsTable,
  echoCharacterFollowsTable,
  echoCharacterPrivacyTable,
  echoUniversesTable,
  type CharacterFollowRequestStatus,
  type CharacterVisibility,
} from "@workspace/db";

type FollowTransaction = Parameters<Parameters<typeof db.transaction>[0]>[0];

export type CharacterIdentity = {
  ownerId: string;
  universeId: string;
  characterId: string;
};

export type FollowTargetInput = {
  sourceUniverseId: string;
  sourceCharacterId: string;
  /** Locator only; authorization always comes from the Clerk session. */
  targetOwnerId: string;
  targetUniverseId: string;
  targetCharacterId: string;
};

export type FollowServiceError =
  | "CHARACTER_NOT_FOUND"
  | "SELF_FOLLOW_NOT_ALLOWED"
  | "FOLLOW_STATE_CONFLICT";

export type FollowServiceResult<T> =
  | { ok: true; value: T }
  | { ok: false; error: FollowServiceError };

type UniverseIdentity = Pick<CharacterIdentity, "ownerId" | "universeId">;
type LockedUniverse = {
  state: unknown;
  sharingEnabled: boolean;
};

function universeKey(value: UniverseIdentity): string {
  return JSON.stringify([value.ownerId, value.universeId]);
}

function characterIds(state: unknown): string[] {
  if (!state || typeof state !== "object") return [];
  const value = (state as { characters?: unknown }).characters;
  if (!Array.isArray(value)) return [];
  return value.flatMap((character) =>
    character && typeof character === "object" &&
    typeof (character as { id?: unknown }).id === "string"
      ? [(character as { id: string }).id]
      : [],
  );
}

function isSameCharacter(source: CharacterIdentity, target: CharacterIdentity): boolean {
  return source.ownerId === target.ownerId &&
    source.universeId === target.universeId &&
    source.characterId === target.characterId;
}

function sourceIdentity(ownerId: string, input: FollowTargetInput): CharacterIdentity {
  return {
    ownerId,
    universeId: input.sourceUniverseId,
    characterId: input.sourceCharacterId,
  };
}

function targetIdentity(input: FollowTargetInput): CharacterIdentity {
  return {
    ownerId: input.targetOwnerId,
    universeId: input.targetUniverseId,
    characterId: input.targetCharacterId,
  };
}

async function lockAndValidateCharacters(
  tx: FollowTransaction,
  identities: CharacterIdentity[],
): Promise<Map<string, LockedUniverse> | null> {
  const universes = [...new Map(identities.map((identity) => [
    universeKey(identity),
    { ownerId: identity.ownerId, universeId: identity.universeId },
  ])).values()].sort((a, b) =>
    a.ownerId.localeCompare(b.ownerId) || a.universeId.localeCompare(b.universeId),
  );
  const states = new Map<string, LockedUniverse>();

  // Stable lock order prevents reciprocal follow operations from deadlocking.
  for (const universe of universes) {
    const [row] = await tx.select({
      state: echoUniversesTable.state,
      sharingEnabled: echoUniversesTable.sharingEnabled,
    })
      .from(echoUniversesTable)
      .where(and(
        eq(echoUniversesTable.ownerId, universe.ownerId),
        eq(echoUniversesTable.universeId, universe.universeId),
        readableUniverseFilter(),
      ))
      .for("update")
      .limit(1);
    if (!row) return null;
    states.set(universeKey(universe), row);
  }

  for (const identity of identities) {
    const universe = states.get(universeKey(identity));
    if (!universe || !characterIds(universe.state).includes(identity.characterId)) return null;
  }
  return states;
}

function relationAllowed(
  source: CharacterIdentity,
  target: CharacterIdentity,
  universes: Map<string, LockedUniverse>,
): boolean {
  if (source.ownerId === target.ownerId) {
    return source.universeId === target.universeId;
  }
  return universes.get(universeKey(target))?.sharingEnabled === true;
}

function pairFilter(
  table: typeof echoCharacterFollowRequestsTable,
  source: CharacterIdentity,
  target: CharacterIdentity,
) {
  return and(
    eq(table.sourceOwnerId, source.ownerId),
    eq(table.sourceUniverseId, source.universeId),
    eq(table.sourceCharacterId, source.characterId),
    eq(table.targetOwnerId, target.ownerId),
    eq(table.targetUniverseId, target.universeId),
    eq(table.targetCharacterId, target.characterId),
  );
}

function activeFollowFilter(source: CharacterIdentity, target: CharacterIdentity) {
  return and(
    eq(echoCharacterFollowsTable.sourceOwnerId, source.ownerId),
    eq(echoCharacterFollowsTable.sourceUniverseId, source.universeId),
    eq(echoCharacterFollowsTable.sourceCharacterId, source.characterId),
    eq(echoCharacterFollowsTable.targetOwnerId, target.ownerId),
    eq(echoCharacterFollowsTable.targetUniverseId, target.universeId),
    eq(echoCharacterFollowsTable.targetCharacterId, target.characterId),
  );
}

async function visibilityInTransaction(
  tx: FollowTransaction,
  target: CharacterIdentity,
): Promise<CharacterVisibility> {
  const [row] = await tx.select({ visibility: echoCharacterPrivacyTable.visibility })
    .from(echoCharacterPrivacyTable)
    .where(and(
      eq(echoCharacterPrivacyTable.ownerId, target.ownerId),
      eq(echoCharacterPrivacyTable.universeId, target.universeId),
      eq(echoCharacterPrivacyTable.characterId, target.characterId),
    ))
    .limit(1);
  return row?.visibility ?? "public";
}

export async function followCharacter(
  authenticatedOwnerId: string,
  input: FollowTargetInput,
): Promise<FollowServiceResult<{ status: "following" } | { status: "pending"; requestId: string }>> {
  const source = sourceIdentity(authenticatedOwnerId, input);
  const target = targetIdentity(input);
  if (isSameCharacter(source, target)) {
    return { ok: false, error: "SELF_FOLLOW_NOT_ALLOWED" };
  }

  return db.transaction(async (tx) => {
    const universes = await lockAndValidateCharacters(tx, [source, target]);
    if (!universes) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    if (!relationAllowed(source, target, universes)) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    const [active] = await tx.select({ sourceCharacterId: echoCharacterFollowsTable.sourceCharacterId })
      .from(echoCharacterFollowsTable)
      .where(activeFollowFilter(source, target))
      .limit(1);
    if (active) return { ok: true, value: { status: "following" } };

    const [pending] = await tx.select({
      id: echoCharacterFollowRequestsTable.id,
    }).from(echoCharacterFollowRequestsTable)
      .where(and(
        pairFilter(echoCharacterFollowRequestsTable, source, target),
        eq(echoCharacterFollowRequestsTable.status, "pending"),
      ))
      .for("update")
      .limit(1);

    const visibility = await visibilityInTransaction(tx, target);
    if (visibility === "public") {
      await tx.insert(echoCharacterFollowsTable).values({
        sourceOwnerId: source.ownerId,
        sourceUniverseId: source.universeId,
        sourceCharacterId: source.characterId,
        targetOwnerId: target.ownerId,
        targetUniverseId: target.universeId,
        targetCharacterId: target.characterId,
      }).onConflictDoNothing();
      if (pending) {
        await tx.update(echoCharacterFollowRequestsTable)
          .set({ status: "accepted", updatedAt: new Date() })
          .where(and(
            eq(echoCharacterFollowRequestsTable.id, pending.id),
            eq(echoCharacterFollowRequestsTable.status, "pending"),
          ));
      }
      return { ok: true, value: { status: "following" } };
    }

    if (pending) return { ok: true, value: { status: "pending", requestId: pending.id } };

    const [created] = await tx.insert(echoCharacterFollowRequestsTable).values({
      sourceOwnerId: source.ownerId,
      sourceUniverseId: source.universeId,
      sourceCharacterId: source.characterId,
      targetOwnerId: target.ownerId,
      targetUniverseId: target.universeId,
      targetCharacterId: target.characterId,
      status: "pending",
    }).onConflictDoNothing().returning({ id: echoCharacterFollowRequestsTable.id });
    if (created) return { ok: true, value: { status: "pending", requestId: created.id } };

    // The partial unique index is the final guard; return its existing row
    // rather than creating a second logical request.
    const [existing] = await tx.select({ id: echoCharacterFollowRequestsTable.id })
      .from(echoCharacterFollowRequestsTable)
      .where(and(
        pairFilter(echoCharacterFollowRequestsTable, source, target),
        eq(echoCharacterFollowRequestsTable.status, "pending"),
      ))
      .limit(1);
    return existing
      ? { ok: true, value: { status: "pending", requestId: existing.id } }
      : { ok: false, error: "FOLLOW_STATE_CONFLICT" };
  });
}

export async function unfollowCharacter(
  authenticatedOwnerId: string,
  input: FollowTargetInput,
): Promise<FollowServiceResult<{ removed: boolean }>> {
  const source = sourceIdentity(authenticatedOwnerId, input);
  const target = targetIdentity(input);
  if (isSameCharacter(source, target)) {
    return { ok: false, error: "SELF_FOLLOW_NOT_ALLOWED" };
  }
  return db.transaction(async (tx) => {
    const universes = await lockAndValidateCharacters(tx, [source, target]);
    if (!universes) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    if (!relationAllowed(source, target, universes)) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    const removed = await tx.delete(echoCharacterFollowsTable)
      .where(activeFollowFilter(source, target))
      .returning({ sourceCharacterId: echoCharacterFollowsTable.sourceCharacterId });
    return { ok: true, value: { removed: removed.length > 0 } };
  });
}

/**
 * Relational social records are removed atomically when a character is
 * actually deleted from a saved universe. Archived characters remain present
 * in the universe and therefore retain their relationships.
 */
export async function removeCharacterSocialRecordsForDeletedCharacters(
  tx: FollowTransaction,
  ownerId: string,
  universeId: string,
  previousState: unknown,
  nextState: unknown,
): Promise<void> {
  const previousCharacters = previousState && typeof previousState === "object"
    ? (previousState as { characters?: unknown }).characters
    : undefined;
  const nextCharacters = nextState && typeof nextState === "object"
    ? (nextState as { characters?: unknown }).characters
    : undefined;
  // If a caller omitted either list, preserve records rather than infer deletes.
  if (!Array.isArray(previousCharacters) || !Array.isArray(nextCharacters)) return;
  const remaining = new Set(characterIds(nextState));
  const removedIds = [...new Set(characterIds(previousState))]
    .filter((characterId) => !remaining.has(characterId));
  if (removedIds.length === 0) return;

  const sourceFollows = and(
    eq(echoCharacterFollowsTable.sourceOwnerId, ownerId),
    eq(echoCharacterFollowsTable.sourceUniverseId, universeId),
    inArray(echoCharacterFollowsTable.sourceCharacterId, removedIds),
  );
  const targetFollows = and(
    eq(echoCharacterFollowsTable.targetOwnerId, ownerId),
    eq(echoCharacterFollowsTable.targetUniverseId, universeId),
    inArray(echoCharacterFollowsTable.targetCharacterId, removedIds),
  );
  const sourceRequests = and(
    eq(echoCharacterFollowRequestsTable.sourceOwnerId, ownerId),
    eq(echoCharacterFollowRequestsTable.sourceUniverseId, universeId),
    inArray(echoCharacterFollowRequestsTable.sourceCharacterId, removedIds),
  );
  const targetRequests = and(
    eq(echoCharacterFollowRequestsTable.targetOwnerId, ownerId),
    eq(echoCharacterFollowRequestsTable.targetUniverseId, universeId),
    inArray(echoCharacterFollowRequestsTable.targetCharacterId, removedIds),
  );
  await tx.delete(echoCharacterFollowsTable).where(or(sourceFollows, targetFollows));
  await tx.delete(echoCharacterFollowRequestsTable).where(or(sourceRequests, targetRequests));
  await tx.delete(echoCharacterPrivacyTable).where(and(
    eq(echoCharacterPrivacyTable.ownerId, ownerId),
    eq(echoCharacterPrivacyTable.universeId, universeId),
    inArray(echoCharacterPrivacyTable.characterId, removedIds),
  ));
}

export async function listOwnFollowRequests(
  authenticatedOwnerId: string,
  universeId: string,
  direction: "incoming" | "outgoing" | "all",
  status: CharacterFollowRequestStatus | "all",
) {
  const sourceInUniverse = and(
    eq(echoCharacterFollowRequestsTable.sourceOwnerId, authenticatedOwnerId),
    eq(echoCharacterFollowRequestsTable.sourceUniverseId, universeId),
  );
  const targetInUniverse = and(
    eq(echoCharacterFollowRequestsTable.targetOwnerId, authenticatedOwnerId),
    eq(echoCharacterFollowRequestsTable.targetUniverseId, universeId),
  );
  const directionFilter = direction === "incoming"
    ? targetInUniverse
    : direction === "outgoing"
      ? sourceInUniverse
      : or(sourceInUniverse, targetInUniverse);
  const statusFilter = status === "all"
    ? undefined
    : eq(echoCharacterFollowRequestsTable.status, status);
  const rows = await db.select({
    requestId: echoCharacterFollowRequestsTable.id,
    sourceOwnerId: echoCharacterFollowRequestsTable.sourceOwnerId,
    sourceUniverseId: echoCharacterFollowRequestsTable.sourceUniverseId,
    sourceCharacterId: echoCharacterFollowRequestsTable.sourceCharacterId,
    targetOwnerId: echoCharacterFollowRequestsTable.targetOwnerId,
    targetUniverseId: echoCharacterFollowRequestsTable.targetUniverseId,
    targetCharacterId: echoCharacterFollowRequestsTable.targetCharacterId,
    status: echoCharacterFollowRequestsTable.status,
    createdAt: echoCharacterFollowRequestsTable.createdAt,
    updatedAt: echoCharacterFollowRequestsTable.updatedAt,
  }).from(echoCharacterFollowRequestsTable)
    .where(statusFilter ? and(directionFilter, statusFilter) : directionFilter)
    .orderBy(desc(echoCharacterFollowRequestsTable.createdAt));

  const universeCache = new Map<string, Promise<LockedUniverse | null>>();
  const readUniverse = (ownerId: string, id: string): Promise<LockedUniverse | null> => {
    const key = universeKey({ ownerId, universeId: id });
    let cached = universeCache.get(key);
    if (!cached) {
      cached = db.select({
        state: echoUniversesTable.state,
        sharingEnabled: echoUniversesTable.sharingEnabled,
      }).from(echoUniversesTable).where(and(
        eq(echoUniversesTable.ownerId, ownerId),
        eq(echoUniversesTable.universeId, id),
        readableUniverseFilter(),
      )).limit(1).then(([row]) => row ?? null);
      universeCache.set(key, cached);
    }
    return cached;
  };
  const visible = [];
  for (const row of rows) {
    const source = {
      ownerId: row.sourceOwnerId,
      universeId: row.sourceUniverseId,
      characterId: row.sourceCharacterId,
    };
    const target = {
      ownerId: row.targetOwnerId,
      universeId: row.targetUniverseId,
      characterId: row.targetCharacterId,
    };
    const sourceUniverse = await readUniverse(source.ownerId, source.universeId);
    const targetUniverse = await readUniverse(target.ownerId, target.universeId);
    if (!sourceUniverse || !targetUniverse ||
      !characterIds(sourceUniverse.state).includes(source.characterId) ||
      !characterIds(targetUniverse.state).includes(target.characterId)) continue;

    if (source.ownerId === target.ownerId) {
      if (source.universeId !== target.universeId || source.universeId !== universeId) continue;
    } else if (!targetUniverse.sharingEnabled) {
      // Historical requests remain stored but cannot reveal an opted-out target.
      continue;
    }
    visible.push(row);
  }
  // Apply the established response cap only after authorization filtering so
  // denied historical rows cannot crowd authorized requests out of the page.
  return visible.slice(0, 100);
}

export async function transitionFollowRequest(
  authenticatedOwnerId: string,
  requestId: string,
  action: "accept" | "reject" | "cancel",
  universeId: string,
): Promise<FollowServiceResult<{ status: CharacterFollowRequestStatus }>> {
  return db.transaction(async (tx) => {
    const [initial] = await tx.select().from(echoCharacterFollowRequestsTable)
      .where(eq(echoCharacterFollowRequestsTable.id, requestId))
      .limit(1);
    if (!initial) return { ok: false, error: "CHARACTER_NOT_FOUND" };
    const actorOwnerId = action === "cancel" ? initial.sourceOwnerId : initial.targetOwnerId;
    if (actorOwnerId !== authenticatedOwnerId) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    const actorUniverseId = action === "cancel" ? initial.sourceUniverseId : initial.targetUniverseId;
    if (actorUniverseId !== universeId) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }

    const source: CharacterIdentity = {
      ownerId: initial.sourceOwnerId,
      universeId: initial.sourceUniverseId,
      characterId: initial.sourceCharacterId,
    };
    const target: CharacterIdentity = {
      ownerId: initial.targetOwnerId,
      universeId: initial.targetUniverseId,
      characterId: initial.targetCharacterId,
    };
    const universes = await lockAndValidateCharacters(tx, [source, target]);
    if (!universes) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    if (!relationAllowed(source, target, universes)) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    const [request] = await tx.select().from(echoCharacterFollowRequestsTable)
      .where(eq(echoCharacterFollowRequestsTable.id, requestId))
      .for("update")
      .limit(1);
    if (!request) return { ok: false, error: "CHARACTER_NOT_FOUND" };
    const expectedOwner = action === "cancel" ? request.sourceOwnerId : request.targetOwnerId;
    if (expectedOwner !== authenticatedOwnerId) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }
    const expectedUniverseId = action === "cancel" ? request.sourceUniverseId : request.targetUniverseId;
    if (expectedUniverseId !== universeId) {
      return { ok: false, error: "CHARACTER_NOT_FOUND" };
    }

    const resultStatus: CharacterFollowRequestStatus =
      action === "accept" ? "accepted" : action === "reject" ? "rejected" : "cancelled";
    if (request.status === resultStatus) {
      return { ok: true, value: { status: resultStatus } };
    }
    if (request.status !== "pending") {
      return { ok: false, error: "FOLLOW_STATE_CONFLICT" };
    }

    if (action === "accept") {
      await tx.insert(echoCharacterFollowsTable).values({
        sourceOwnerId: source.ownerId,
        sourceUniverseId: source.universeId,
        sourceCharacterId: source.characterId,
        targetOwnerId: target.ownerId,
        targetUniverseId: target.universeId,
        targetCharacterId: target.characterId,
      }).onConflictDoNothing();
    }
    const [updated] = await tx.update(echoCharacterFollowRequestsTable)
      .set({ status: resultStatus, updatedAt: new Date() })
      .where(and(
        eq(echoCharacterFollowRequestsTable.id, requestId),
        eq(echoCharacterFollowRequestsTable.status, "pending"),
      ))
      .returning({ status: echoCharacterFollowRequestsTable.status });
    return updated
      ? { ok: true, value: { status: updated.status } }
      : { ok: false, error: "FOLLOW_STATE_CONFLICT" };
  });
}
