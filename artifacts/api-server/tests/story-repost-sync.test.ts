import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../../echo/src/store/seed';
import { mergeUniverse } from '../../echo/src/store/merge';
import type { SocialState, Story } from '../../echo/src/domain/types';

function setup(): { base: SocialState; source: Story; repost: Story } {
  const base = createSeedState();
  const source: Story = {
    id: 'source-story', authorId: 'mar', image: 'asset:mar-avatar',
    caption: 'Rehearsal', createdAt: '2026-11-18T10:00:00.000Z',
    seenBy: [], origin: 'user', mentionedAccountIds: ['nela'],
    closeFriendsOnly: true, allowedViewerIds: ['nela'],
    musicClip: { title: 'Original clip', artist: 'Pretty Violence', startSeconds: 0, durationSeconds: 15 } as Story['musicClip'],
  };
  const repost: Story = {
    ...structuredClone(source), id: 'reposted-story', authorId: 'nela',
    repostOfStoryId: source.id, seenBy: [],
  };
  base.stories = [source];
  return { base, source, repost };
}

test('a tagged story repost survives synchronization without duplicating the source', () => {
  const { base, repost } = setup();
  const local = structuredClone(base);
  local.stories.push(repost);
  const remote = structuredClone(base);
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.stories.filter(s => s.id === repost.id).length, 1);
  assert.equal(result.state.stories.find(s => s.id === repost.id)?.repostOfStoryId, 'source-story');
});

test('a repost retains source attribution, audience metadata, and music through merge', () => {
  const { base, repost } = setup();
  const local = structuredClone(base);
  local.stories.push(repost);
  const result = mergeUniverse(base, local, structuredClone(base));
  const saved = result.state.stories.find(s => s.id === repost.id);
  assert.equal(saved?.repostOfStoryId, 'source-story');
  assert.deepEqual(saved?.allowedViewerIds, ['nela']);
  assert.equal(saved?.closeFriendsOnly, true);
  assert.deepEqual(saved?.musicClip, repost.musicClip);
});

test('server removal of a repost is not undone by an unchanged local cache', () => {
  const { base, repost } = setup();
  base.stories.push(repost);
  const local = structuredClone(base);
  const remote = structuredClone(base);
  remote.stories = remote.stories.filter(s => s.id !== repost.id);
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.stories.some(s => s.id === repost.id), false);
});
