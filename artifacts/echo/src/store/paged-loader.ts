import { loadCharacterPage, loadMessagePage, loadPostPage } from './persistence';
import { ApiError } from '@workspace/api-client-react';

/** A server-side edit between pages invalidates the entire snapshot. */
export class StalePageSnapshot extends Error {
  constructor() { super('The universe changed while loading pages; restart from page one.'); }
}

type PageKind = 'characters' | 'posts' | 'messages';
type PageRecord = {
  characters: Awaited<ReturnType<typeof loadCharacterPage>>['characters'];
  posts: Awaited<ReturnType<typeof loadPostPage>>['posts'];
  messages: Awaited<ReturnType<typeof loadMessagePage>>['messages'];
};

/**
 * Fetch a bounded, revision-consistent collection. Never silently merge
 * pages from different revisions. This is a transitional client utility:
 * consumers should prefer windowed/infinite-scroll rendering over loading all.
 */
export async function loadConsistentPages<K extends PageKind>(options: {
  kind: K;
  universeId?: string;
  authorId?: string;
  threadId?: string;
  pageSize?: number;
  maxItems?: number;
  signal?: AbortSignal;
}): Promise<{ items: PageRecord[K]; revision: number; total: number; hasMore: boolean }> {
  const { kind, universeId = 'primary', pageSize = 24, maxItems = 120, signal } = options;
  if (!Number.isSafeInteger(pageSize) || pageSize < 1 || pageSize > 50 ||
      !Number.isSafeInteger(maxItems) || maxItems < 1 || maxItems > 1000) {
    throw new Error('Invalid page bounds');
  }
  if (kind === 'messages' && !options.threadId) throw new Error('threadId is required');
  if (signal?.aborted) throw new Error('Page loading cancelled');
  let revision: number | undefined;
  let offset = 0;
  let total = 0;
  const items: unknown[] = [];
  while (items.length < maxItems) {
    if (signal?.aborted) throw new Error('Page loading cancelled');
    const limit = Math.min(pageSize, maxItems - items.length);
    let response: { revision: number; total: number; nextOffset: number | null; entries: unknown[] };
    try {
      if (kind === 'characters') {
        const page = await loadCharacterPage(universeId, offset, limit, revision);
        response = { revision: page.revision, total: page.total, nextOffset: page.nextOffset, entries: page.characters };
      } else if (kind === 'posts') {
        const page = await loadPostPage({ universeId, authorId: options.authorId, offset, limit, revision });
        response = { revision: page.revision, total: page.total, nextOffset: page.nextOffset, entries: page.posts };
      } else {
        const page = await loadMessagePage({ universeId, threadId: options.threadId!, offset, limit, revision });
        response = { revision: page.revision, total: page.total, nextOffset: page.nextOffset, entries: page.messages };
      }
    } catch (error) {
      if (error instanceof ApiError && error.status === 409) throw new StalePageSnapshot();
      throw error;
    }
    if (signal?.aborted) throw new Error('Page loading cancelled');
    if (revision !== undefined && response.revision !== revision) throw new StalePageSnapshot();
    revision = response.revision;
    total = response.total;
    const pageItems = response.entries;
    if (!Array.isArray(pageItems) || pageItems.length > limit ||
        !Number.isSafeInteger(response.total) || response.total < 0 ||
        !Number.isSafeInteger(response.revision) || response.revision < 0)
      throw new Error('Invalid paginated response');
    items.push(...pageItems);
    if (response.nextOffset === null) break;
    if (!Number.isSafeInteger(response.nextOffset) || response.nextOffset <= offset || pageItems.length === 0)
      throw new Error('Invalid pagination cursor');
    offset = response.nextOffset;
  }
  return { items: items as PageRecord[K], revision: revision ?? 0, total, hasMore: items.length < total };
}
