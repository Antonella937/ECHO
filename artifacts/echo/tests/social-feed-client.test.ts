import assert from 'node:assert/strict';
import { test } from 'node:test';
import {
  buildSocialFeedUrl,
  createSocialFeedContext,
  requestSocialFeedPage,
  SocialFeedContractError,
  SocialFeedRequestError,
  socialFeedQueryKey,
  type SocialFeedContext,
} from '../src/lib/social-feed-client';

const auth = { isLoaded: true, isSignedIn: true, ownerId: 'clerk-owner-a' };
const universe = {
  currentCharacterId: 'viewer-a',
  characters: [{ id: 'viewer-a' }, { id: 'archived-viewer', archived: true }],
};
const context = createSocialFeedContext(auth, 'studio', universe)!;

const validPage = {
  items: [{
    identity: { ownerId: 'owner-b', universeId: 'primary', characterId: 'same-character-id' },
    post: {
      id: 'same-post-id',
      authorId: 'same-character-id',
      image: '',
      caption: 'Read-only post',
      location: '',
      createdAt: '2026-01-01T00:00:00.000Z',
      media: [{ id: 'media-1', type: 'image', url: '/objects/photo-1' }],
      likes: ['must-not-be-consumed'],
      savedBy: ['must-not-be-consumed'],
      comments: ['must-not-be-consumed'],
    },
  }],
  nextCursor: 'cursor-1',
};

test('unauthenticated or invalid viewer state produces no feed context', () => {
  assert.equal(createSocialFeedContext({ ...auth, isLoaded: false }, 'studio', universe), null);
  assert.equal(createSocialFeedContext({ ...auth, isSignedIn: false }, 'studio', universe), null);
  assert.equal(createSocialFeedContext({ ...auth, ownerId: '' }, 'studio', universe), null);
  assert.equal(createSocialFeedContext(auth, 'studio', { ...universe, currentCharacterId: 'missing' }), null);
  assert.equal(createSocialFeedContext(auth, 'studio', {
    ...universe,
    currentCharacterId: 'archived-viewer',
  }), null);
  assert.equal(createSocialFeedContext(auth, null, universe), null);
});

test('the request contract contains only backend-supported viewer and page parameters', () => {
  const url = new URL(buildSocialFeedUrl(context, {
    cursor: 'cursor value',
    limit: 12,
    mediaOnly: true,
  }), 'https://echo.test');
  assert.equal(url.pathname, '/api/social/feed');
  assert.deepEqual([...url.searchParams.keys()].sort(), [
    'cursor',
    'limit',
    'mediaOnly',
    'viewerCharacterId',
    'viewerUniverseId',
  ]);
  assert.equal(url.searchParams.get('viewerUniverseId'), 'studio');
  assert.equal(url.searchParams.get('viewerCharacterId'), 'viewer-a');
  assert.equal(url.searchParams.get('cursor'), 'cursor value');
  assert.equal(url.searchParams.get('limit'), '12');
  assert.equal(url.searchParams.get('mediaOnly'), 'true');
  assert.equal(url.searchParams.has('ownerId'), false);
});

test('invalid page limits and cursors are rejected before fetch', () => {
  assert.throws(() => buildSocialFeedUrl(context, { limit: 51 }), RangeError);
  assert.throws(() => buildSocialFeedUrl(context, { limit: 0 }), RangeError);
  assert.throws(() => buildSocialFeedUrl(context, { cursor: ' '.repeat(2) }), RangeError);
  assert.throws(() => buildSocialFeedUrl(context, { cursor: 'x'.repeat(1401) }), RangeError);
});

test('successful response is validated and strips fields outside the allowlisted contract', async () => {
  let calledUrl = '';
  let calledInit: RequestInit | undefined;
  const fetcher: typeof fetch = async (input, init) => {
    calledUrl = String(input);
    calledInit = init;
    return new Response(JSON.stringify({
      ...validPage,
      internalOwnerId: 'not-consumed',
    }), { status: 200, headers: { 'content-type': 'application/json' } });
  };

  const result = await requestSocialFeedPage(context, { limit: 20 }, fetcher);
  assert.equal(calledUrl.startsWith('/api/social/feed?'), true);
  assert.equal(calledInit?.method, 'GET');
  assert.equal(calledInit?.credentials, 'same-origin');
  assert.equal(calledInit?.cache, 'no-store');
  assert.equal(result.items.length, 1);
  assert.deepEqual(result.items[0]?.identity, validPage.items[0]?.identity);
  assert.equal(result.items[0]?.post.caption, 'Read-only post');
  assert.equal('likes' in (result.items[0]?.post ?? {}), false);
  assert.equal('savedBy' in (result.items[0]?.post ?? {}), false);
  assert.equal('comments' in (result.items[0]?.post ?? {}), false);
  assert.equal('internalOwnerId' in result, false);
  assert.equal(result.nextCursor, 'cursor-1');
});

test('missing auth context is rejected without calling fetch', async () => {
  let called = false;
  const fetcher: typeof fetch = async () => {
    called = true;
    return new Response('{}');
  };
  await assert.rejects(
    requestSocialFeedPage(null, {}, fetcher),
    /authenticated owner and viewer character/,
  );
  assert.equal(called, false);
});

test('HTTP failures surface their status without treating them as feed data', async () => {
  const fetcher: typeof fetch = async () => new Response('unauthorized', { status: 401 });
  await assert.rejects(requestSocialFeedPage(context, {}, fetcher), (error: unknown) => {
    assert.ok(error instanceof SocialFeedRequestError);
    assert.equal(error.status, 401);
    return true;
  });
});

test('invalid response shape or mismatched author identity is rejected', async () => {
  const fetcher: typeof fetch = async () => new Response(JSON.stringify({
    items: [{
      identity: { ownerId: 'owner-b', universeId: 'primary', characterId: 'char-a' },
      post: {
        id: 'post-a',
        authorId: 'char-b',
        image: '',
        caption: '',
        location: '',
        createdAt: '2026-01-01T00:00:00.000Z',
      },
    }],
    nextCursor: null,
  }), { status: 200 });
  await assert.rejects(requestSocialFeedPage(context, {}, fetcher), SocialFeedContractError);
});

test('query cache identity separates owners, universes, viewers and pages', () => {
  const key = socialFeedQueryKey(context, { cursor: 'next', limit: 10 });
  const otherOwner: SocialFeedContext = { ...context, ownerId: 'clerk-owner-b' };
  const otherUniverse: SocialFeedContext = { ...context, universeId: 'primary' };
  const otherViewer: SocialFeedContext = { ...context, viewerCharacterId: 'viewer-b' };
  assert.notDeepEqual(key, socialFeedQueryKey(otherOwner, { cursor: 'next', limit: 10 }));
  assert.notDeepEqual(key, socialFeedQueryKey(otherUniverse, { cursor: 'next', limit: 10 }));
  assert.notDeepEqual(key, socialFeedQueryKey(otherViewer, { cursor: 'next', limit: 10 }));
  assert.notDeepEqual(key, socialFeedQueryKey(context, { cursor: 'other', limit: 10 }));
});
