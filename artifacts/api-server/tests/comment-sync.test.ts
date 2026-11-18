import test from 'node:test';
import assert from 'node:assert/strict';
import { createSeedState } from '../../echo/src/store/seed';
import { mergeUniverse } from '../../echo/src/store/merge';
import type { Comment, SocialState } from '../../echo/src/domain/types';

const comment = (id: string, text: string): Comment => ({
  id, postId: 'post-test', authorId: 'nela', text,
  createdAt: '2026-11-18T10:00:00.000Z', parentId: null,
  replyToAuthorId: null, likes: [], origin: 'user',
});

function stateWithComment(value: Comment): SocialState {
  const state = createSeedState();
  return { ...state, posts: [...state.posts, {
    ...state.posts[0], id: 'post-test',
  }], comments: [value] };
}

test('server-deleted comment is not resurrected by an unchanged local cache', () => {
  const base = stateWithComment(comment('deleted-comment', 'Old comment'));
  const local = structuredClone(base);
  const remote = structuredClone(base);
  remote.comments = [];
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts.length, 0);
  assert.equal(result.state.comments.some(c => c.id === 'deleted-comment'), false);
});

test('a local comment edit conflicts with a server deletion', () => {
  const base = stateWithComment(comment('edited-comment', 'Before'));
  const local = structuredClone(base);
  local.comments[0].text = 'Edited offline';
  const remote = structuredClone(base);
  remote.comments = [];
  const result = mergeUniverse(base, local, remote);
  assert.ok(result.conflicts.some(c => c.path === 'comments.edited-comment'));
});

test('new offline comment survives when absent from remote', () => {
  const base = stateWithComment(comment('existing-comment', 'Existing'));
  const local = structuredClone(base);
  local.comments.push(comment('new-comment', 'New offline'));
  const remote = structuredClone(base);
  const result = mergeUniverse(base, local, remote);
  assert.ok(result.state.comments.some(c => c.id === 'new-comment'));
});
