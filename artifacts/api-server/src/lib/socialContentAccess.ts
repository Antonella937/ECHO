import { and, eq, isNull, or } from "drizzle-orm";
import {
  db,
  echoCharacterFollowsTable,
  echoCharacterPrivacyTable,
  echoUniversesTable,
} from "@workspace/db";
import type { CharacterIdentity } from "./characterFollows";

export type CharacterFollowEdge = {
  source: CharacterIdentity;
  target: CharacterIdentity;
};

export type SocialContentViewer = {
  universeId: string;
  characterId: string;
};

export type SocialMediaSource = {
  universeId: string;
  characterId: string;
  contentType: "post" | "story" | "avatar";
  contentId: string;
};

type PlainRecord = Record<string, unknown>;

/** Content availability, independent of character privacy or sharing consent. */
export function readableUniverseFilter() {
  return and(isNull(echoUniversesTable.archivedAt), isNull(echoUniversesTable.deletedAt));
}

function record(value: unknown): PlainRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PlainRecord
    : null;
}

function stringValue(value: unknown): string | null {
  return typeof value === "string" && value.length > 0 ? value : null;
}

function stateCharacters(state: unknown): PlainRecord[] {
  const characters = record(state)?.characters;
  return Array.isArray(characters)
    ? characters.map(record).filter((item): item is PlainRecord => item !== null)
    : [];
}

function identityKey(identity: CharacterIdentity): string {
  return JSON.stringify([identity.ownerId, identity.universeId, identity.characterId]);
}

function edgeKey(edge: CharacterFollowEdge): string {
  return JSON.stringify([identityKey(edge.source), identityKey(edge.target)]);
}

function edge(
  sourceOwnerId: string,
  sourceUniverseId: string,
  sourceCharacterId: string,
  targetOwnerId: string,
  targetUniverseId: string,
  targetCharacterId: string,
): CharacterFollowEdge {
  return {
    source: { ownerId: sourceOwnerId, universeId: sourceUniverseId, characterId: sourceCharacterId },
    target: { ownerId: targetOwnerId, universeId: targetUniverseId, characterId: targetCharacterId },
  };
}

/**
 * Reads both relation sources into one deduplicated, fully scoped graph.
 * Legacy JSON identifies characters only inside its containing owner/universe;
 * it is never guessed to refer to a character in another owner or universe.
 */
export async function readAcceptedCharacterFollows(
  ownerId: string,
  universeId: string,
): Promise<CharacterFollowEdge[]> {
  const [universe] = await db.select({ state: echoUniversesTable.state })
    .from(echoUniversesTable)
    .where(and(
      eq(echoUniversesTable.ownerId, ownerId),
      eq(echoUniversesTable.universeId, universeId),
      readableUniverseFilter(),
    ))
    .limit(1);
  if (!universe) return [];

  const characters = stateCharacters(universe.state);
  const characterIds = new Set(characters.map((character) => stringValue(character.id)).filter(
    (id): id is string => id !== null,
  ));
  const result = new Map<string, CharacterFollowEdge>();
  const follows = record(record(universe.state)?.follows);
  for (const [sourceCharacterId, rawTargets] of Object.entries(follows ?? {})) {
    if (!characterIds.has(sourceCharacterId) || !Array.isArray(rawTargets)) continue;
    for (const rawTarget of rawTargets) {
      if (typeof rawTarget !== "string" || !characterIds.has(rawTarget) || rawTarget === sourceCharacterId) continue;
      const value = edge(ownerId, universeId, sourceCharacterId, ownerId, universeId, rawTarget);
      result.set(edgeKey(value), value);
    }
  }

  const relationalRows = await db.select().from(echoCharacterFollowsTable).where(or(
    and(
      eq(echoCharacterFollowsTable.sourceOwnerId, ownerId),
      eq(echoCharacterFollowsTable.sourceUniverseId, universeId),
    ),
    and(
      eq(echoCharacterFollowsTable.targetOwnerId, ownerId),
      eq(echoCharacterFollowsTable.targetUniverseId, universeId),
    ),
  ));
  for (const row of relationalRows) {
    // Retained historical edges never override current endpoint availability.
    const endpoints = await Promise.all([
      { ownerId: row.sourceOwnerId, universeId: row.sourceUniverseId },
      { ownerId: row.targetOwnerId, universeId: row.targetUniverseId },
    ].map(async identity => {
      const [available] = await db.select({ sharingEnabled: echoUniversesTable.sharingEnabled })
        .from(echoUniversesTable).where(and(
          eq(echoUniversesTable.ownerId, identity.ownerId),
          eq(echoUniversesTable.universeId, identity.universeId),
          readableUniverseFilter(),
        )).limit(1);
      return available;
    }));
    if (!endpoints[0] || !endpoints[1]) continue;
    if (row.sourceOwnerId === row.targetOwnerId
      ? row.sourceUniverseId !== row.targetUniverseId
      : !endpoints[1].sharingEnabled) continue;
    const value = edge(
      row.sourceOwnerId,
      row.sourceUniverseId,
      row.sourceCharacterId,
      row.targetOwnerId,
      row.targetUniverseId,
      row.targetCharacterId,
    );
    result.set(edgeKey(value), value);
  }
  return [...result.values()];
}

function hasIdentity(state: unknown, characterId: string): boolean {
  return stateCharacters(state).some((character) => character.id === characterId);
}

function sameIdentity(a: CharacterIdentity, b: CharacterIdentity): boolean {
  return a.ownerId === b.ownerId &&
    a.universeId === b.universeId &&
    a.characterId === b.characterId;
}

/**
 * The sole policy decision for a social character read. Callers must already
 * have authenticated the owner; private access needs an exact accepted edge.
 */
export async function canReadSocialCharacter(
  authenticatedOwnerId: string,
  target: CharacterIdentity,
  viewer?: SocialContentViewer,
): Promise<boolean> {
  // Validate the selected viewer even for public content and owner reads.
  if (viewer) {
    const [selected] = await db.select({ state: echoUniversesTable.state })
      .from(echoUniversesTable).where(and(
        eq(echoUniversesTable.ownerId, authenticatedOwnerId),
        eq(echoUniversesTable.universeId, viewer.universeId),
        readableUniverseFilter(),
      )).limit(1);
    if (!selected || !hasIdentity(selected.state, viewer.characterId)) return false;
  }
  if (!authenticatedOwnerId) return false;
  const [targetUniverse] = await db.select({
    state: echoUniversesTable.state,
    sharingEnabled: echoUniversesTable.sharingEnabled,
  })
    .from(echoUniversesTable)
    .where(and(
      eq(echoUniversesTable.ownerId, target.ownerId),
      eq(echoUniversesTable.universeId, target.universeId),
      readableUniverseFilter(),
    ))
    .limit(1);
  const targetCharacter = targetUniverse
    ? stateCharacters(targetUniverse.state).find((character) => character.id === target.characterId)
    : undefined;
  if (!targetCharacter) return false;
  if (authenticatedOwnerId === target.ownerId) {
    // A direct owner read remains available, but a request made in another
    // selected universe must not cross this universe boundary.
    return !viewer || viewer.universeId === target.universeId;
  }
  if (!targetUniverse.sharingEnabled) return false;
  if (targetCharacter.archived === true) return false;

  const [privacy] = await db.select({ visibility: echoCharacterPrivacyTable.visibility })
    .from(echoCharacterPrivacyTable)
    .where(and(
      eq(echoCharacterPrivacyTable.ownerId, target.ownerId),
      eq(echoCharacterPrivacyTable.universeId, target.universeId),
      eq(echoCharacterPrivacyTable.characterId, target.characterId),
    ))
    .limit(1);
  // Missing settings retain the product's documented default: public.
  if (!privacy || privacy.visibility === "public") return true;
  if (!viewer) return false;

  const viewerIdentity: CharacterIdentity = {
    ownerId: authenticatedOwnerId,
    universeId: viewer.universeId,
    characterId: viewer.characterId,
  };
  const [viewerUniverse] = await db.select({ state: echoUniversesTable.state })
    .from(echoUniversesTable)
    .where(and(
      eq(echoUniversesTable.ownerId, authenticatedOwnerId),
      eq(echoUniversesTable.universeId, viewer.universeId),
      readableUniverseFilter(),
    ))
    .limit(1);
  if (!viewerUniverse || !hasIdentity(viewerUniverse.state, viewer.characterId)) return false;
  const edges = await readAcceptedCharacterFollows(authenticatedOwnerId, viewer.universeId);
  return edges.some((candidate) =>
    sameIdentity(candidate.source, viewerIdentity) && sameIdentity(candidate.target, target),
  );
}

export function storyIsStillVisible(state: PlainRecord, story: PlainRecord, nowMs: number): boolean {
  const storyId = stringValue(story.id);
  const authorId = stringValue(story.authorId);
  const createdAt = typeof story.createdAt === "string" || story.createdAt instanceof Date
    ? new Date(story.createdAt).getTime()
    : Number.NaN;
  const active = Number.isFinite(createdAt) && createdAt <= nowMs && nowMs - createdAt < 24 * 60 * 60 * 1000;
  if (active) return true;
  if (!storyId || !authorId) return false;
  const highlights = record(state)?.highlights;
  return Array.isArray(highlights) && highlights.some((value) => {
    const highlight = record(value);
    return highlight?.authorId === authorId &&
      Array.isArray(highlight.storyIds) &&
      highlight.storyIds.includes(storyId);
  });
}

function matchesMediaSource(
  stateValue: unknown,
  objectPath: string,
  source: SocialMediaSource,
  ownerRead = false,
): boolean {
  const state = record(stateValue);
  if (!state) return false;
  const character = stateCharacters(state).find((item) => item.id === source.characterId);
  if (!character || (!ownerRead && character.archived === true)) return false;

  if (source.contentType === "avatar") {
    return source.contentId === source.characterId && character.avatar === objectPath;
  }
  if (source.contentType === "post") {
    const posts = Array.isArray(state.posts) ? state.posts : [];
    const post = posts.map(record).find((item) =>
      item?.id === source.contentId && item.authorId === source.characterId);
    return Boolean(post && (
      post.image === objectPath ||
      (Array.isArray(post.media) && post.media.some((item) => record(item)?.url === objectPath))
    ));
  }
  const stories = Array.isArray(state.stories) ? state.stories : [];
  const story = stories.map(record).find((item) =>
    item?.id === source.contentId && item.authorId === source.characterId);
  return Boolean(
    story &&
    story.image === objectPath &&
    (ownerRead || storyIsStillVisible(state, story, Date.now())),
  );
}

/**
 * Authorizes a private object only when it is actually referenced by a
 * currently readable public/private character surface. Unattached uploads
 * remain owner-only. The return value never contains content metadata.
 */
export async function canReadSocialMedia(
  authenticatedOwnerId: string,
  mediaOwnerId: string,
  objectPath: string,
  source?: SocialMediaSource,
  viewer?: SocialContentViewer,
): Promise<boolean> {
  if (!authenticatedOwnerId) return false;
  if (authenticatedOwnerId === mediaOwnerId && !source) {
    // Legacy owner URLs omit source identity. An archived association must not
    // be bypassed by dropping query parameters, including shared objects.
    const universes = await db.select({
      state: echoUniversesTable.state,
      archivedAt: echoUniversesTable.archivedAt,
      deletedAt: echoUniversesTable.deletedAt,
      universeId: echoUniversesTable.universeId,
    }).from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, mediaOwnerId));
    if (viewer && !universes.some(universe => universe.universeId === viewer.universeId &&
      !universe.archivedAt && !universe.deletedAt && hasIdentity(universe.state, viewer.characterId))) return false;
    return !universes.some(universe =>
      (universe.archivedAt || universe.deletedAt) && containsObjectPath(universe.state, objectPath));
  }
  if (!source) return false;

  const [universe] = await db.select({ state: echoUniversesTable.state })
    .from(echoUniversesTable)
    .where(and(
      eq(echoUniversesTable.ownerId, mediaOwnerId),
      eq(echoUniversesTable.universeId, source.universeId),
      readableUniverseFilter(),
    ))
    .limit(1);
  if (!universe || !matchesMediaSource(universe.state, objectPath, source, authenticatedOwnerId === mediaOwnerId)) return false;
  return canReadSocialCharacter(
    authenticatedOwnerId,
    { ownerId: mediaOwnerId, universeId: source.universeId, characterId: source.characterId },
    viewer,
  );
}

/** Include attachments nested in messages/configuration, not only feed media. */
function containsObjectPath(value: unknown, objectPath: string): boolean {
  if (typeof value === "string") return value === objectPath;
  if (Array.isArray(value)) return value.some(item => containsObjectPath(item, objectPath));
  const object = record(value);
  return object ? Object.values(object).some(item => containsObjectPath(item, objectPath)) : false;
}
