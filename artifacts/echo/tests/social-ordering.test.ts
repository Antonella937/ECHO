import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveUniverseBody } from '@workspace/api-zod';
import { createSeedState } from '../src/store/seed';
import { universeAccountError } from '../../api-server/src/lib/universeValidation';
import { getOrderedPinnedPosts, movePinnedPost, setPinnedPost, getOrderedHighlights, moveHighlight, saveHighlight, highlightCover } from '../src/domain/social-features';

function fixture() {
  const s = createSeedState();
  s.posts = [0, 1, 2, 3].map(i => ({ ...s.posts[0], id: `p${i}`, authorId: 'nela',
    createdAt: new Date(2026, 0, i + 1).toISOString(), pinned: false }));
  s.stories = [0, 1, 2].map(i => ({ ...s.stories[0], id: `s${i}`, authorId: 'nela' }));
  s.highlights = []; s.comments = []; s.messages = []; s.notifications = [];
  return s;
}
const pinIds = (s: ReturnType<typeof fixture>) => getOrderedPinnedPosts(s, 'nela').map(p => p.id);
const highlightIds = (s: ReturnType<typeof fixture>) => getOrderedHighlights(s, 'nela').map(h => h.id);

test('legacy pinned posts preserve date-descending order without requiring migration', () => {
  const s = fixture();
  s.posts.slice(0, 3).forEach(p => { p.pinned = true; });
  assert.deepEqual(pinIds(s), ['p2', 'p1', 'p0']);
  assert.equal(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state), null);
});
test('manual pinned order survives the real contract and JSON reload, independently of post date', () => {
  let s = fixture();
  for (const id of ['p0', 'p1', 'p2']) s = setPinnedPost(s, id, 'nela', true);
  assert.deepEqual(pinIds(s), ['p0', 'p1', 'p2']);
  s = movePinnedPost(s, 'p2', 'nela', -1);
  s = movePinnedPost(s, 'p2', 'nela', -1);
  const parsed = SaveUniverseBody.parse({ state: JSON.parse(JSON.stringify(s)), expectedRevision: 1 }).state;
  assert.deepEqual(pinIds(JSON.parse(JSON.stringify(parsed))), ['p2', 'p0', 'p1']);
  assert.equal(universeAccountError(parsed), null);
});
test('unpin releases capacity and order; fourth pin and wrong active identity are rejected', () => {
  let s = fixture();
  for (const id of ['p0', 'p1', 'p2']) s = setPinnedPost(s, id, 'nela', true);
  assert.throws(() => setPinnedPost(s, 'p3', 'nela', true), /3/);
  assert.throws(() => movePinnedPost(s, 'p0', 'mar', 1));
  assert.throws(() => movePinnedPost(s, 'p3', 'nela', 1));
  s = setPinnedPost(s, 'p1', 'nela', false);
  assert.equal(s.posts.find(p => p.id === 'p1')!.pinOrder, undefined);
  s = setPinnedPost(s, 'p3', 'nela', true);
  assert.deepEqual(pinIds(s), ['p0', 'p2', 'p3']);
});
test('pin movement at boundaries is inert and never changes another identity or universe', () => {
  let s = fixture();
  s.posts.push({ ...s.posts[0], id: 'foreign-post', authorId: 'mar', pinned: true, pinOrder: 0 });
  s = setPinnedPost(s, 'p0', 'nela', true);
  const otherUniverse = structuredClone(s), other = structuredClone(s.posts.at(-1));
  const moved = movePinnedPost(s, 'p0', 'nela', -1);
  assert.deepEqual(moved.posts.at(-1), other);
  assert.deepEqual(otherUniverse, s);
  assert.deepEqual(pinIds(moved), ['p0']);
});
test('legacy highlight order remains stable and editing does not move its collection', () => {
  let s = fixture();
  s.highlights = ['b', 'a'].map(id => ({ id, authorId: 'nela', title: id, storyIds: ['s0'] }));
  assert.deepEqual(highlightIds(s), ['b', 'a']);
  const initial = structuredClone(s.highlights[0]);
  s = saveHighlight(s, 'nela', { ...initial, title: 'Edited' }, initial);
  assert.deepEqual(highlightIds(s), ['b', 'a']);
  assert.equal(s.highlights!.find(h => h.id === 'b')!.title, 'Edited');
});
test('manual highlight order survives contract, reload and another identity', () => {
  let s = fixture();
  for (const id of ['a', 'b', 'c']) s = saveHighlight(s, 'nela', { id, title: id, authorId: 'nela', storyIds: ['s0'] });
  s.stories.push({ ...s.stories[0], id: 'mar-story', authorId: 'mar' });
  s.highlights!.push({ id: 'other', title: 'Other', authorId: 'mar', storyIds: ['mar-story'] });
  const other = structuredClone(s.highlights!.at(-1));
  s = moveHighlight(s, 'c', 'nela', -1);
  s = moveHighlight(s, 'c', 'nela', -1);
  assert.deepEqual(highlightIds(s), ['c', 'a', 'b']);
  assert.deepEqual(s.highlights!.at(-1), other);
  assert.throws(() => moveHighlight(s, 'c', 'mar', -1));
  const parsed = SaveUniverseBody.parse({ state: JSON.parse(JSON.stringify(s)), expectedRevision: 1 }).state;
  assert.equal(universeAccountError(parsed), null);
  assert.deepEqual(highlightIds(JSON.parse(JSON.stringify(parsed))), ['c', 'a', 'b']);
});
test('selected highlight cover persists and uses only a Story inside the collection', () => {
  let s = fixture();
  s = saveHighlight(s, 'nela', { id: 'a', title: 'A', authorId: 'nela', storyIds: ['s0', 's1'], coverStoryId: 's1' });
  const parsed = SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state;
  assert.equal(universeAccountError(parsed), null);
  assert.equal(highlightCover(JSON.parse(JSON.stringify(parsed)), parsed.highlights![0])?.id, 's1');
});
test('removing chosen cover falls back automatically without deleting a Story', () => {
  let s = fixture();
  s = saveHighlight(s, 'nela', { id: 'a', title: 'A', authorId: 'nela', storyIds: ['s0', 's1'], coverStoryId: 's1' });
  const initial = structuredClone(s.highlights![0]);
  s = saveHighlight(s, 'nela', { ...initial, storyIds: ['s0'] }, initial);
  assert.equal(s.highlights![0].coverStoryId, null);
  assert.equal(highlightCover(s, s.highlights![0])?.id, 's0');
  assert.equal(s.stories.length, 3);
});
test('missing cover reference falls back safely; wrong-author references never supply a cover', () => {
  const s = fixture();
  const h = { id: 'a', title: 'A', authorId: 'nela', storyIds: ['missing', 's0'], coverStoryId: 'missing' };
  assert.equal(highlightCover(s, h)?.id, 's0');
  s.stories[0].authorId = 'mar';
  assert.equal(highlightCover(s, h), undefined);
});
test('expired Story in a highlight remains a valid selectable cover', () => {
  const s = fixture();
  s.stories[0].createdAt = '2020-01-01T00:00:00Z';
  const h = { id: 'a', title: 'A', authorId: 'nela', storyIds: ['s0'], coverStoryId: 's0' };
  const next = saveHighlight(s, 'nela', h);
  assert.equal(highlightCover(next, h)?.id, 's0');
  assert.equal(universeAccountError(SaveUniverseBody.parse({ state: next, expectedRevision: 1 }).state), null);
});
test('backend rejects ranks outside bounds, duplicate ranks and cover outside its collection', () => {
  const s = fixture();
  s.posts[0].pinned = true; s.posts[0].pinOrder = 3;
  assert.equal(SaveUniverseBody.safeParse({ state: s, expectedRevision: 1 }).success, false);
  s.posts[0].pinOrder = 0; s.posts[1].pinned = true; s.posts[1].pinOrder = 0;
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state), null);
  s.posts[1].pinOrder = 1;
  s.highlights = [{ id: 'a', title: 'A', authorId: 'nela', storyIds: ['s0'], coverStoryId: 's1' }];
  assert.notEqual(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state), null);
});
test('stale highlight editing and selecting another identity Story are rejected', () => {
  let s = fixture();
  s = saveHighlight(s, 'nela', { id: 'a', title: 'A', authorId: 'nela', storyIds: ['s0'] });
  const old = structuredClone(s.highlights![0]);
  s = saveHighlight(s, 'nela', { ...old, title: 'Newer' }, old);
  assert.throws(() => saveHighlight(s, 'nela', { ...old, title: 'Stale' }, old));
  assert.throws(() => saveHighlight(s, 'mar', { id: 'b', title: 'B', authorId: 'mar', storyIds: ['s0'] }));
});

test('the editor save operation moves a collection atomically while retaining its selected cover', () => {
  let s = fixture();
  for (const id of ['a', 'b', 'c']) s = saveHighlight(s, 'nela', { id, title: id, authorId: 'nela', storyIds: ['s0', 's1'], coverStoryId: 's1' });
  const initial = structuredClone(s.highlights!.find(h => h.id === 'c')!);
  s = saveHighlight(s, 'nela', { ...initial, title: 'Moved', order: 0 }, initial);
  assert.deepEqual(highlightIds(s), ['c', 'a', 'b']);
  assert.equal(s.highlights!.find(h => h.id === 'c')!.coverStoryId, 's1');
  assert.equal(universeAccountError(SaveUniverseBody.parse({ state: s, expectedRevision: 1 }).state), null);
});
test('cover fallback skips inaccessible image candidates without crossing collections or authors', () => {
  const s = fixture();
  const h = { id: 'a', title: 'A', authorId: 'nela', storyIds: ['s0', 's1'], coverStoryId: 's1' };
  assert.equal(highlightCover(s, h, ['s1'])?.id, 's0');
  assert.equal(highlightCover(s, h, ['s0', 's1']), undefined);
});
test('highlight editing tolerates JSONB object key order but still detects real stale changes', () => {
  let s = fixture();
  s = saveHighlight(s, 'nela', { id: 'a', title: 'A', authorId: 'nela', storyIds: ['s0'] });
  const current = s.highlights![0];
  const reorderedKeys = Object.fromEntries(Object.entries(current).reverse()) as typeof current;
  assert.doesNotThrow(() => saveHighlight(s, 'nela', { ...current, title: 'Edited' }, reorderedKeys));
  assert.throws(() => saveHighlight(s, 'nela', { ...current, title: 'Edited' }, { ...current, coverStoryId: 's0' }));
});
test('automatic covers preserve the legacy state order rather than changing existing collection artwork', () => {
  const s = fixture();
  const h = { id: 'a', title: 'A', authorId: 'nela', storyIds: ['s1', 's0'] };
  assert.equal(highlightCover(s, h)?.id, 's0');
  assert.equal(highlightCover(s, { ...h, coverStoryId: 's1' })?.id, 's1');
});
