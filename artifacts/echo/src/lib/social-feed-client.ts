import { z } from 'zod';

export interface SocialFeedContext {
  /** Clerk session id; used only to scope the client cache, never sent as a query parameter. */
  ownerId: string;
  universeId: string;
  viewerCharacterId: string;
}

export interface SocialFeedAuthState {
  isLoaded: boolean;
  isSignedIn: boolean;
  ownerId: string | null | undefined;
}

export interface SocialFeedUniverseState {
  currentCharacterId: string | null | undefined;
  characters: readonly { id: string; archived?: boolean }[];
}

export interface SocialFeedPageOptions {
  cursor?: string;
  limit?: number;
  mediaOnly?: boolean;
}

const mediaSchema = z.object({
  id: z.string(),
  type: z.string(),
  url: z.string(),
  mimeType: z.string().optional(),
  width: z.number().finite().optional(),
  height: z.number().finite().optional(),
  durationSeconds: z.number().finite().optional(),
});

const identitySchema = z.object({
  ownerId: z.string().min(1),
  universeId: z.string().min(1),
  characterId: z.string().min(1),
});

const authorSchema = z.object({
  displayName: z.string().optional(),
  handle: z.string().optional(),
  avatar: z.string().optional(),
  verified: z.boolean().optional(),
});

const postSchema = z.object({
  id: z.string().min(1),
  authorId: z.string().min(1),
  image: z.string(),
  media: z.array(mediaSchema).optional(),
  caption: z.string(),
  location: z.string(),
  createdAt: z.string().min(1),
  commentsEnabled: z.boolean().optional(),
  pinned: z.boolean().optional(),
});

const feedItemSchema = z.object({
  identity: identitySchema,
  author: authorSchema,
  post: postSchema,
}).superRefine(({ identity, post }, context) => {
  if (identity.characterId !== post.authorId) {
    context.addIssue({
      code: z.ZodIssueCode.custom,
      path: ['post', 'authorId'],
      message: 'Post author does not match its full character identity.',
    });
  }
});

const feedPageSchema = z.object({
  items: z.array(feedItemSchema),
  nextCursor: z.string().min(1).nullable(),
});

export type SocialFeedPage = z.infer<typeof feedPageSchema>;

export function createSocialFeedContext(
  auth: SocialFeedAuthState,
  activeUniverseId: string | null | undefined,
  state: SocialFeedUniverseState | null | undefined,
): SocialFeedContext | null {
  const ownerId = auth.ownerId?.trim();
  const universeId = activeUniverseId?.trim();
  const viewerCharacterId = state?.currentCharacterId?.trim();
  if (!auth.isLoaded || !auth.isSignedIn || !ownerId || !universeId || !viewerCharacterId || !state) return null;

  const viewerExists = state.characters.some(
    (character) => character.id === viewerCharacterId && character.archived !== true,
  );
  if (!viewerExists) return null;

  return { ownerId, universeId, viewerCharacterId };
}

export function socialFeedQueryKey(
  context: SocialFeedContext | null,
  options: SocialFeedPageOptions = {},
) {
  return [
    'social-feed-page',
    context?.ownerId ?? null,
    context?.universeId ?? null,
    context?.viewerCharacterId ?? null,
    options.cursor ?? null,
    options.limit ?? 20,
    options.mediaOnly ?? false,
  ] as const;
}

export function buildSocialFeedUrl(
  context: SocialFeedContext,
  options: SocialFeedPageOptions = {},
): string {
  const limit = options.limit ?? 20;
  if (!Number.isInteger(limit) || limit < 1 || limit > 50) {
    throw new RangeError('Social feed limit must be an integer from 1 to 50.');
  }
  if (options.cursor !== undefined && (!options.cursor.trim() || options.cursor.length > 1400)) {
    throw new RangeError('Social feed cursor is invalid.');
  }

  const params = new URLSearchParams({
    viewerUniverseId: context.universeId,
    viewerCharacterId: context.viewerCharacterId,
    limit: String(limit),
  });
  if (options.cursor) params.set('cursor', options.cursor);
  if (options.mediaOnly !== undefined) params.set('mediaOnly', String(options.mediaOnly));
  return `/api/social/feed?${params.toString()}`;
}

export class SocialFeedRequestError extends Error {
  constructor(readonly status: number) {
    super(`Social feed request failed (${status}).`);
    this.name = 'SocialFeedRequestError';
  }
}

export class SocialFeedContractError extends Error {
  constructor() {
    super('Social feed response did not match the API contract.');
    this.name = 'SocialFeedContractError';
  }
}

export async function requestSocialFeedPage(
  context: SocialFeedContext | null,
  options: SocialFeedPageOptions = {},
  fetcher: typeof fetch = fetch,
  signal?: AbortSignal,
): Promise<SocialFeedPage> {
  if (!context) throw new Error('An authenticated owner and viewer character are required.');

  const response = await fetcher(buildSocialFeedUrl(context, options), {
    method: 'GET',
    credentials: 'same-origin',
    cache: 'no-store',
    ...(signal ? { signal } : {}),
  });
  if (!response.ok) throw new SocialFeedRequestError(response.status);

  let body: unknown;
  try {
    body = await response.json();
  } catch {
    throw new SocialFeedContractError();
  }
  const parsed = feedPageSchema.safeParse(body);
  if (!parsed.success) throw new SocialFeedContractError();
  return parsed.data;
}
