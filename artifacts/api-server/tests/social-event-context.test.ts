import test from 'node:test';
import assert from 'node:assert/strict';
import { socialEventContext } from '../src/ai-engine/social-event-context';

test('a cross-group comment reply retains the post and parent comment identities', () => {
  const context = socialEventContext({
    situation: 'comment', actorId: 'noah-group-2',
    post: { id: 'post-1', authorId: 'noah-group-2', caption: 'Rehearsal tonight' },
    parentComment: { id: 'comment-1', authorId: 'mar-group-1', text: 'Did you tune that?' },
  });
  assert.match(context, /Actor ECHO character: noah-group-2/);
  assert.match(context, /Visible comment ID: comment-1; by mar-group-1: Did you tune that\?/);
  assert.match(context, /Post ID: post-1/);
});

test('likes of comments require the comment itself', () => {
  assert.throws(() => socialEventContext({
    situation: 'like_comment', actorId: 'mar',
    post: { id: 'post-1', authorId: 'noah' },
  }), /SOCIAL_COMMENT_REQUIRED/);
});
