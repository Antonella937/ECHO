import test from 'node:test';
import assert from 'node:assert/strict';
import { createStarterUniverse } from '../src/store/create-starter-universe';
import { editStoryMetrics, storyViewCount, storyViewerIds, shownCount, editPostMetrics, editAccount, accountFormValues } from '../src/domain/accounts';
import { mergeUniverse } from '../src/store/merge';
import { applyEvent, makeEvent } from '../src/domain/events';
import { SaveUniverseBody } from '@workspace/api-zod';
import type { SocialState } from '../src/domain/types';

function fixture(): SocialState {
  const s = createStarterUniverse({ plan: 'creator', universeName: 'Metrics fixture', displayName: 'Fixture', username: 'metrics_fixture', bio: '' });
  s.characters.push({ ...structuredClone(s.characters[0]), id: 'mar', name: 'Other', handle: 'other_fixture' });
  s.stories = [{ id: 's0', authorId: 'nela', image: 'asset:account-default', caption: '', createdAt: '2020-01-01T00:00:00Z', seenBy: ['mar'], origin: 'user' }];
  s.posts = [{ id: 'p0', authorId: 'nela', image: '', caption: '', location: '', createdAt: new Date().toISOString(), likes: ['mar'], savedBy: [], origin: 'user', illustrative: false }];
  return s;
}
test('existing post and profile bases add to real activity without creating interactions', () => {
  let s = fixture();
  const follows = structuredClone(s.follows);
  s = editPostMetrics(s, 'p0', { likes: 100, comments: 20 });
  assert.equal(shownCount(s.posts[0].displayMetrics?.likes, s.posts[0].likes.length), 101);
  assert.equal(shownCount(s.posts[0].displayMetrics?.comments, 2), 22);
  s = editAccount(s, 'nela', { ...accountFormValues(s.characters[0]), displayMetrics: { followers: 50, following: 10 } });
  assert.equal(shownCount(s.characters[0].displayMetrics?.followers, 3), 53);
  assert.equal(shownCount(s.characters[0].displayMetrics?.following, 2), 12);
  assert.deepEqual(s.posts[0].likes, ['mar']);
  assert.deepEqual(s.follows, follows);
});
test('legacy Stories without a base keep real views; author and duplicate memberships never inflate totals', () => {
  const s = fixture(); s.stories[0].seenBy = ['mar', 'mar', 'nela', 'historical-id'];
  assert.equal(storyViewCount(s.stories[0]), 2);
  assert.deepEqual(storyViewerIds(s.stories[0]), ['mar', 'historical-id']);
  assert.equal(s.stories[0].seenBy.length, 4);
});
test('base editing and clearing preserve every real viewer, reaction and Story field', () => {
  let s = fixture(); const before = structuredClone(s.stories[0]);
  s = editStoryMetrics(s, 's0', 'nela', { views: 100 }, {});
  assert.equal(storyViewCount(s.stories[0]), 101);
  assert.deepEqual({ ...s.stories[0], displayMetrics: undefined }, { ...before, displayMetrics: undefined });
  s = editStoryMetrics(s, 's0', 'nela', { views: null }, { views: 100 });
  assert.equal(storyViewCount(s.stories[0]), 1);
  assert.deepEqual(s.stories[0].seenBy, ['mar']);
});
test('only the active author action can edit its Story; missing and archived identities reject', () => {
  const s = fixture();
  assert.throws(() => editStoryMetrics(s, 's0', 'mar', { views: 10 }));
  assert.throws(() => editStoryMetrics(s, 'missing', 'nela', { views: 10 }));
  s.currentCharacterId = 'mar';
  assert.throws(() => editStoryMetrics(s, 's0', 'nela', { views: 10 }));
  s.currentCharacterId = 'nela';
  s.characters[0].archived = true;
  assert.throws(() => editStoryMetrics(s, 's0', 'nela', { views: 10 }));
});
test('base range is integer zero to 1e12, including reset and both numeric boundaries', () => {
  const s = fixture();
  for (const views of [0, 1e12, null]) assert.doesNotThrow(() => editStoryMetrics(s, 's0', 'nela', { views }));
  for (const views of [-1, 1.5, 1e12 + 1, NaN, Infinity]) assert.throws(() => editStoryMetrics(s, 's0', 'nela', { views }));
});
test('Story contract preserves bases and raw legacy viewers through JSON reload without a destructive migration', () => {
  const s = editStoryMetrics(fixture(), 's0', 'nela', { views: 100 });
  const parsed = SaveUniverseBody.parse({ state: s, expectedRevision: 0 }).state;
  const read = JSON.parse(JSON.stringify(parsed)) as SocialState;
  assert.equal(storyViewCount(read.stories[0]), 101);
  assert.deepEqual(read.stories[0].seenBy, ['mar']);
  for (const views of [-1, 1.1, 1e12 + 1, '10']) {
    const bad = { ...s, stories: s.stories.map(story => ({ ...story, displayMetrics: { views } })) };
    assert.equal(SaveUniverseBody.safeParse({ state: bad, expectedRevision: 0 }).success, false);
  }
});
test('concurrent view recording and base editing merge without lost views or double-counting', () => {
  const base = fixture();
  const local = editStoryMetrics(base, 's0', 'nela', { views: 40 }, {});
  const remote = structuredClone(base); remote.stories[0].seenBy.push('viewer2', 'viewer2');
  const merged = mergeUniverse(base, local, remote);
  assert.equal(merged.conflicts.length, 0);
  assert.deepEqual(storyViewerIds(merged.state.stories[0]), ['mar', 'viewer2']);
  assert.equal(storyViewCount(merged.state.stories[0]), 42);
});
test('stale base drafts reject rather than overwrite another edit, without changing seenBy', () => {
  const s = editStoryMetrics(fixture(), 's0', 'nela', { views: 30 });
  assert.throws(() => editStoryMetrics(s, 's0', 'nela', { views: 40 }, { views: 20 }));
  assert.equal(s.stories[0].displayMetrics?.views, 30);
  assert.deepEqual(s.stories[0].seenBy, ['mar']);
});
test('repeated real view events are idempotent and are not replaced by narrative edits', () => {
  let s = fixture();
  const ev = makeEvent({ type: 'story.seen', storyId: 's0', actorId: 'mar' }, 'user');
  s = applyEvent(applyEvent(s, ev), ev);
  s = editStoryMetrics(s, 's0', 'nela', { views: 10 });
  assert.equal(storyViewCount(s.stories[0]), 11);
});
test('identical Story IDs in another universe remain untouched, including expired highlights', () => {
  const primary = fixture(), studio = fixture();
  primary.highlights = [{ id: 'h0', authorId: 'nela', title: 'Old', storyIds: ['s0'] }];
  const changed = editStoryMetrics(primary, 's0', 'nela', { views: 75 });
  assert.equal(storyViewCount(changed.stories[0]), 76);
  assert.equal(storyViewCount(studio.stories[0]), 1);
  assert.deepEqual(changed.highlights, primary.highlights);
});
