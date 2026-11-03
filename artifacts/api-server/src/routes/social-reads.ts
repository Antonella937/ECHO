import { and, eq } from "drizzle-orm";
import { db, echoUniversesTable } from "@workspace/db";
import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import type { CharacterIdentity } from "../lib/characterFollows";
import {
  canReadSocialCharacter,
  storyIsStillVisible,
  type SocialContentViewer,
} from "../lib/socialContentAccess";

type PlainRecord = Record<string, unknown>;
type LoadedUniverse = { ownerId: string; universeId: string; state: unknown };
type SocialReadItem = {
  ownerId: string;
  universeId: string;
  characterId: string;
  itemId: string;
  createdAt: string;
};

const idSchema = z.string().trim().min(1).max(255);
const universeIdSchema = z.string().trim().min(1).max(120);
const targetParamsSchema = z.object({
  targetOwnerId: idSchema,
  targetUniverseId: universeIdSchema,
  targetCharacterId: idSchema,
}).strict();

const viewerQueryShape = {
  viewerUniverseId: universeIdSchema.optional(),
  viewerCharacterId: idSchema.optional(),
};

const pageFields = {
  cursor: z.string().trim().min(1).max(1400).optional(),
  limit: z.coerce.number().int().min(1).max(50).default(20),
  mediaOnly: z.enum(["true", "false"]).default("false").transform((value) => value === "true"),
};

const viewerQuerySchema = z.object(viewerQueryShape).strict().refine((value) =>
  Boolean(value.viewerUniverseId) === Boolean(value.viewerCharacterId),
);

const pageQuerySchema = z.object({ ...viewerQueryShape, ...pageFields }).strict().refine((value) =>
  Boolean(value.viewerUniverseId) === Boolean(value.viewerCharacterId),
);

const feedQuerySchema = z.object({
  viewerUniverseId: universeIdSchema,
  viewerCharacterId: idSchema,
  ...pageFields,
}).strict();

const cursorSchema = z.object({
  createdAt: z.string().min(1).max(80),
  ownerId: idSchema,
  universeId: universeIdSchema,
  characterId: idSchema,
  itemId: idSchema,
}).strict();

type SocialCursor = z.infer<typeof cursorSchema>;
type PageInput = {
  cursor?: SocialCursor;
  limit: number;
  mediaOnly: boolean;
  viewer?: SocialContentViewer;
};

type SocialReadRouterOptions = { authenticate?: RequestHandler };

function asRecord(value: unknown): PlainRecord | null {
  return value && typeof value === "object" && !Array.isArray(value)
    ? value as PlainRecord
    : null;
}

function arrayOfRecords(value: unknown): PlainRecord[] {
  return Array.isArray(value)
    ? value.map(asRecord).filter((item): item is PlainRecord => item !== null)
    : [];
}

function stringField(value: PlainRecord, key: string): string | undefined {
  return typeof value[key] === "string" ? value[key] as string : undefined;
}

function dateString(value: unknown): string | null {
  const date = value instanceof Date ? value : typeof value === "string" ? new Date(value) : null;
  return date && Number.isFinite(date.getTime()) ? date.toISOString() : null;
}

function identityKey(item: Pick<SocialReadItem, "ownerId" | "universeId" | "characterId">): string {
  return JSON.stringify([item.ownerId, item.universeId, item.characterId]);
}

function compareTie(
  a: Pick<SocialReadItem, "ownerId" | "universeId" | "characterId" | "itemId">,
  b: Pick<SocialReadItem, "ownerId" | "universeId" | "characterId" | "itemId">,
): number {
  for (const key of ["ownerId", "universeId", "characterId", "itemId"] as const) {
    const compared = a[key].localeCompare(b[key]);
    if (compared) return compared;
  }
  return 0;
}

function cursorMatchesTarget(cursor: SocialCursor | undefined, target: CharacterIdentity): boolean {
  return !cursor || (
    cursor.ownerId === target.ownerId &&
    cursor.universeId === target.universeId &&
    cursor.characterId === target.characterId
  );
}

function encodeCursor(item: SocialReadItem): string {
  return Buffer.from(JSON.stringify({
    createdAt: item.createdAt,
    ownerId: item.ownerId,
    universeId: item.universeId,
    characterId: item.characterId,
    itemId: item.itemId,
  }), "utf8").toString("base64url");
}

function decodeCursor(value: string | undefined): SocialCursor | undefined | null {
  if (value === undefined) return undefined;
  if (!/^[A-Za-z0-9_-]{1,1400}$/.test(value)) return null;
  try {
    const parsed = cursorSchema.safeParse(JSON.parse(Buffer.from(value, "base64url").toString("utf8")));
    if (!parsed.success || !dateString(parsed.data.createdAt)) return null;
    return parsed.data;
  } catch {
    return null;
  }
}

function compareItems(a: SocialReadItem, b: SocialReadItem): number {
  const time = Date.parse(b.createdAt) - Date.parse(a.createdAt);
  return time || compareTie(a, b);
}

function followsCursor(item: SocialReadItem, cursor: SocialCursor): boolean {
  const time = Date.parse(item.createdAt) - Date.parse(cursor.createdAt);
  return time < 0 || (time === 0 && compareTie(item, {
    ownerId: cursor.ownerId,
    universeId: cursor.universeId,
    characterId: cursor.characterId,
    itemId: cursor.itemId,
  }) > 0);
}

function paginate<T extends SocialReadItem>(
  items: T[],
  limit: number,
  cursor?: SocialCursor,
): { items: T[]; nextCursor: string | null } {
  const ordered = items
    .filter((item) => !cursor || followsCursor(item, cursor))
    .sort(compareItems);
  const page = ordered.slice(0, limit);
  return {
    items: page,
    nextCursor: ordered.length > limit && page.length
      ? encodeCursor(page[page.length - 1]!)
      : null,
  };
}

function hasMedia(value: PlainRecord): boolean {
  return (typeof value.image === "string" && value.image.length > 0) ||
    arrayOfRecords(value.media).some((item) => typeof item.url === "string" && item.url.length > 0);
}

function projectPost(value: PlainRecord): PlainRecord | null {
  const id = stringField(value, "id");
  const authorId = stringField(value, "authorId");
  const createdAt = dateString(value.createdAt);
  if (!id || !authorId || !createdAt) return null;

  const projectedMedia = arrayOfRecords(value.media).flatMap((item) => {
    const mediaId = stringField(item, "id");
    const type = stringField(item, "type");
    const url = stringField(item, "url");
    if (!mediaId || !type || !url) return [];
    const safe: PlainRecord = { id: mediaId, type, url };
    for (const key of ["mimeType", "width", "height", "durationSeconds"]) {
      const field = item[key];
      if (typeof field === "string" || (typeof field === "number" && Number.isFinite(field))) safe[key] = field;
    }
    return [safe];
  });

  const projected: PlainRecord = {
    id,
    authorId,
    caption: stringField(value, "caption") ?? "",
    location: stringField(value, "location") ?? "",
    image: stringField(value, "image") ?? "",
    createdAt,
  };
  if (projectedMedia.length) projected.media = projectedMedia;
  if (typeof value.commentsEnabled === "boolean") projected.commentsEnabled = value.commentsEnabled;
  if (typeof value.pinned === "boolean") projected.pinned = value.pinned;
  return projected;
}

function projectStory(value: PlainRecord, highlighted: boolean): PlainRecord | null {
  const id = stringField(value, "id");
  const authorId = stringField(value, "authorId");
  const createdAt = dateString(value.createdAt);
  if (!id || !authorId || !createdAt) return null;
  const projected: PlainRecord = {
    id,
    authorId,
    image: stringField(value, "image") ?? "",
    caption: stringField(value, "caption") ?? "",
    createdAt,
    highlighted,
  };
  const music = asRecord(value.music);
  if (music) {
    const title = stringField(music, "title");
    const artist = stringField(music, "artist");
    if (title || artist) projected.music = { title: title ?? "", artist: artist ?? "" };
  }
  return projected;
}

function projectProfile(value: PlainRecord): PlainRecord {
  const profile: PlainRecord = {
    id: stringField(value, "id") ?? "",
    handle: stringField(value, "handle") ?? "",
    name: stringField(value, "name") ?? "",
    occupation: stringField(value, "occupation") ?? "",
    bio: stringField(value, "bio") ?? "",
    location: stringField(value, "location") ?? "",
    avatar: stringField(value, "avatar") ?? "",
    verified: value.verified === true,
  };
  const accountType = stringField(value, "accountType");
  if (accountType) profile.accountType = accountType;
  return profile;
}

function sendNotFound(res: Parameters<RequestHandler>[1]): void {
  res.status(404).json({ error: "SOCIAL_CONTENT_NOT_FOUND" });
}

function setPrivateNoStore(res: Parameters<RequestHandler>[1]): void {
  res.setHeader("Cache-Control", "private, no-store");
}

function parseTarget(
  params: unknown,
  res: Parameters<RequestHandler>[1],
): CharacterIdentity | null {
  const raw = asRecord(params);
  const parsed = targetParamsSchema.safeParse({
    targetOwnerId: raw?.targetOwnerId,
    targetUniverseId: raw?.targetUniverseId,
    targetCharacterId: raw?.targetCharacterId,
  });
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_SOCIAL_TARGET" });
    return null;
  }
  return {
    ownerId: parsed.data.targetOwnerId,
    universeId: parsed.data.targetUniverseId,
    characterId: parsed.data.targetCharacterId,
  };
}

function parseViewerQuery(
  query: unknown,
  res: Parameters<RequestHandler>[1],
): { ok: true; viewer?: SocialContentViewer } | { ok: false } {
  const parsed = viewerQuerySchema.safeParse(query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_SOCIAL_READ_QUERY" });
    return { ok: false };
  }
  return {
    ok: true,
    viewer: parsed.data.viewerUniverseId
      ? { universeId: parsed.data.viewerUniverseId, characterId: parsed.data.viewerCharacterId! }
      : undefined,
  };
}

function parsePageQuery(
  query: unknown,
  res: Parameters<RequestHandler>[1],
): { ok: true; page: PageInput } | { ok: false } {
  const parsed = pageQuerySchema.safeParse(query);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_SOCIAL_READ_QUERY" });
    return { ok: false };
  }
  const cursor = decodeCursor(parsed.data.cursor);
  if (cursor === null) {
    res.status(400).json({ error: "INVALID_SOCIAL_CURSOR" });
    return { ok: false };
  }
  return {
    ok: true,
    page: {
      cursor,
      limit: parsed.data.limit,
      mediaOnly: parsed.data.mediaOnly,
      viewer: parsed.data.viewerUniverseId
        ? { universeId: parsed.data.viewerUniverseId, characterId: parsed.data.viewerCharacterId! }
        : undefined,
    },
  };
}

async function loadUniverse(ownerId: string, universeId: string): Promise<LoadedUniverse | null> {
  const [row] = await db.select({
    ownerId: echoUniversesTable.ownerId,
    universeId: echoUniversesTable.universeId,
    state: echoUniversesTable.state,
  }).from(echoUniversesTable).where(and(
    eq(echoUniversesTable.ownerId, ownerId),
    eq(echoUniversesTable.universeId, universeId),
  )).limit(1);
  return row ?? null;
}

async function readAuthorizedTarget(
  viewerOwnerId: string,
  target: CharacterIdentity,
  viewer: SocialContentViewer | undefined,
): Promise<{ universe: LoadedUniverse; character: PlainRecord } | null> {
  const universe = await loadUniverse(target.ownerId, target.universeId);
  if (!universe) return null;
  const character = arrayOfRecords(asRecord(universe.state)?.characters)
    .find((candidate) => candidate.id === target.characterId);
  if (!character) return null;
  if (!await canReadSocialCharacter(viewerOwnerId, target, viewer)) return null;
  return { universe, character };
}

type VisibleStoryItem = SocialReadItem & { projected: PlainRecord };

function buildVisibleStories(stateValue: unknown, identity: CharacterIdentity): VisibleStoryItem[] {
  const state = asRecord(stateValue);
  if (!state) return [];
  const highlights = arrayOfRecords(state.highlights);
  const stories = arrayOfRecords(state.stories);
  return stories.flatMap((story) => {
    if (story.authorId !== identity.characterId) return [];
    const id = stringField(story, "id");
    const createdAt = dateString(story.createdAt);
    if (!id || !createdAt || !storyIsStillVisible(state, story, Date.now())) return [];
    const highlighted = highlights.some((highlight) =>
      highlight.authorId === identity.characterId &&
      Array.isArray(highlight.storyIds) &&
      highlight.storyIds.includes(id),
    );
    const projected = projectStory(story, highlighted);
    if (!projected) return [];
    return [{
      ...identity,
      itemId: id,
      createdAt,
      projected,
    }];
  });
}

function safeLogFailure(req: Parameters<RequestHandler>[0]): void {
  const log = (req as typeof req & { log?: { error: (bindings: object, message: string) => void } }).log;
  log?.error({ code: "SOCIAL_READ_FAILED" }, "Social read request failed");
}

export function createSocialReadRouter(options: SocialReadRouterOptions = {}): IRouter {
  const router: IRouter = Router();
  const authenticate = options.authenticate ?? requireAuth;

  router.get("/social/feed", authenticate, async (req, res): Promise<void> => {
    setPrivateNoStore(res);
    const parsed = feedQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_SOCIAL_READ_QUERY" });
      return;
    }
    const cursor = decodeCursor(parsed.data.cursor);
    if (cursor === null) {
      res.status(400).json({ error: "INVALID_SOCIAL_CURSOR" });
      return;
    }

    const ownerId = req.userId!;
    const viewer = {
      universeId: parsed.data.viewerUniverseId,
      characterId: parsed.data.viewerCharacterId,
    };
    try {
      const viewerUniverse = await loadUniverse(ownerId, viewer.universeId);
      if (!viewerUniverse || !arrayOfRecords(asRecord(viewerUniverse.state)?.characters)
        .some((character) => character.id === viewer.characterId)) {
        sendNotFound(res);
        return;
      }

      const universes = await db.select({
        ownerId: echoUniversesTable.ownerId,
        universeId: echoUniversesTable.universeId,
        state: echoUniversesTable.state,
      }).from(echoUniversesTable);
      const items: Array<SocialReadItem & { identity: CharacterIdentity; post: PlainRecord }> = [];
      const visibility = new Map<string, Promise<boolean>>();
      for (const universe of universes) {
        // Preserve the selected universe as the owner's own feed boundary.
        if (universe.ownerId === ownerId && universe.universeId !== viewer.universeId) continue;
        const state = asRecord(universe.state);
        if (!state) continue;
        const characters = arrayOfRecords(state.characters);
        const byAuthor = new Map<string, PlainRecord[]>();
        for (const post of arrayOfRecords(state.posts)) {
          const authorId = stringField(post, "authorId");
          if (!authorId) continue;
          byAuthor.set(authorId, [...(byAuthor.get(authorId) ?? []), post]);
        }
        for (const character of characters) {
          const characterId = stringField(character, "id");
          if (!characterId || character.archived === true) continue;
          const identity = {
            ownerId: universe.ownerId,
            universeId: universe.universeId,
            characterId,
          };
          const key = identityKey(identity);
          let canRead = visibility.get(key);
          if (!canRead) {
            canRead = canReadSocialCharacter(ownerId, identity, viewer);
            visibility.set(key, canRead);
          }
          if (!await canRead) continue;
          for (const postValue of byAuthor.get(characterId) ?? []) {
            if (parsed.data.mediaOnly && !hasMedia(postValue)) continue;
            const post = projectPost(postValue);
            if (!post) continue;
            items.push({
              ...identity,
              itemId: post.id as string,
              createdAt: post.createdAt as string,
              identity,
              post,
            });
          }
        }
      }

      const page = paginate(items, parsed.data.limit, cursor ?? undefined);
      res.json({
        items: page.items.map(({ identity, post }) => ({ identity, post })),
        nextCursor: page.nextCursor,
      });
    } catch {
      safeLogFailure(req);
      res.status(500).json({ error: "SOCIAL_READ_FAILED" });
    }
  });

  router.get(
    "/social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId",
    authenticate,
    async (req, res): Promise<void> => {
      setPrivateNoStore(res);
      const target = parseTarget(req.params, res);
      if (!target) return;
      const query = parseViewerQuery(req.query, res);
      if (!query.ok) return;
      try {
        const authorized = await readAuthorizedTarget(req.userId!, target, query.viewer);
        if (!authorized) {
          sendNotFound(res);
          return;
        }
        res.json({
          identity: target,
          profile: projectProfile(authorized.character),
        });
      } catch {
        safeLogFailure(req);
        res.status(500).json({ error: "SOCIAL_READ_FAILED" });
      }
    },
  );

  router.get(
    "/social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/posts",
    authenticate,
    async (req, res): Promise<void> => {
      setPrivateNoStore(res);
      const target = parseTarget(req.params, res);
      if (!target) return;
      const parsed = parsePageQuery(req.query, res);
      if (!parsed.ok) return;
      if (!cursorMatchesTarget(parsed.page.cursor, target)) {
        res.status(400).json({ error: "INVALID_SOCIAL_CURSOR" });
        return;
      }
      try {
        const authorized = await readAuthorizedTarget(req.userId!, target, parsed.page.viewer);
        if (!authorized) {
          sendNotFound(res);
          return;
        }
        const items = arrayOfRecords(asRecord(authorized.universe.state)?.posts).flatMap((value) => {
          if (value.authorId !== target.characterId) return [];
          if (parsed.page.mediaOnly && !hasMedia(value)) return [];
          const post = projectPost(value);
          if (!post) return [];
          return [{
            ...target,
            itemId: post.id as string,
            createdAt: post.createdAt as string,
            post,
          }];
        });
        const page = paginate(items, parsed.page.limit, parsed.page.cursor);
        res.json({ posts: page.items.map((item) => item.post), nextCursor: page.nextCursor });
      } catch {
        safeLogFailure(req);
        res.status(500).json({ error: "SOCIAL_READ_FAILED" });
      }
    },
  );

  router.get(
    "/social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/posts/:postId",
    authenticate,
    async (req, res): Promise<void> => {
      setPrivateNoStore(res);
      const target = parseTarget(req.params, res);
      const postId = idSchema.safeParse(req.params.postId);
      if (!target || !postId.success) {
        if (target) res.status(400).json({ error: "INVALID_SOCIAL_TARGET" });
        return;
      }
      const query = parseViewerQuery(req.query, res);
      if (!query.ok) return;
      try {
        const authorized = await readAuthorizedTarget(req.userId!, target, query.viewer);
        if (!authorized) {
          sendNotFound(res);
          return;
        }
        const post = arrayOfRecords(asRecord(authorized.universe.state)?.posts)
          .find((candidate) => candidate.authorId === target.characterId && candidate.id === postId.data);
        const projected = post ? projectPost(post) : null;
        if (!projected) {
          sendNotFound(res);
          return;
        }
        res.json({ identity: target, post: projected });
      } catch {
        safeLogFailure(req);
        res.status(500).json({ error: "SOCIAL_READ_FAILED" });
      }
    },
  );

  router.get(
    "/social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/stories",
    authenticate,
    async (req, res): Promise<void> => {
      setPrivateNoStore(res);
      const target = parseTarget(req.params, res);
      if (!target) return;
      const parsed = parsePageQuery(req.query, res);
      if (!parsed.ok) return;
      if (!cursorMatchesTarget(parsed.page.cursor, target)) {
        res.status(400).json({ error: "INVALID_SOCIAL_CURSOR" });
        return;
      }
      try {
        const authorized = await readAuthorizedTarget(req.userId!, target, parsed.page.viewer);
        if (!authorized) {
          sendNotFound(res);
          return;
        }
        const items = buildVisibleStories(authorized.universe.state, target)
          .filter((item) => !parsed.page.mediaOnly || hasMedia(item.projected));
        const page = paginate(items, parsed.page.limit, parsed.page.cursor);
        res.json({ stories: page.items.map((item) => item.projected), nextCursor: page.nextCursor });
      } catch {
        safeLogFailure(req);
        res.status(500).json({ error: "SOCIAL_READ_FAILED" });
      }
    },
  );

  router.get(
    "/social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/stories/:storyId",
    authenticate,
    async (req, res): Promise<void> => {
      setPrivateNoStore(res);
      const target = parseTarget(req.params, res);
      const storyId = idSchema.safeParse(req.params.storyId);
      if (!target || !storyId.success) {
        if (target) res.status(400).json({ error: "INVALID_SOCIAL_TARGET" });
        return;
      }
      const query = parseViewerQuery(req.query, res);
      if (!query.ok) return;
      try {
        const authorized = await readAuthorizedTarget(req.userId!, target, query.viewer);
        if (!authorized) {
          sendNotFound(res);
          return;
        }
        const story = buildVisibleStories(authorized.universe.state, target)
          .find((item) => item.itemId === storyId.data);
        if (!story) {
          sendNotFound(res);
          return;
        }
        res.json({ identity: target, story: story.projected });
      } catch {
        safeLogFailure(req);
        res.status(500).json({ error: "SOCIAL_READ_FAILED" });
      }
    },
  );

  return router;
}

export const socialReadRouter = createSocialReadRouter();
