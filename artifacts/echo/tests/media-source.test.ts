import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createStarterUniverse } from '../src/store/create-starter-universe';
import { mediaSourceFor, privateMediaUrl, type MediaScope, type MediaSource } from '../src/lib/media-source';

const path = '/objects/uploads/shared';
function fixture(universeId = 'studio'): MediaScope {
  const state = createStarterUniverse({ plan: 'creator', universeName: universeId,
    displayName: 'Fixture', username: 'fixture', bio: '' });
  const author = state.characters[0].id;
  state.characters[0].avatar = path;
  state.posts = [{ id: 'same-post', authorId: author, image: path, caption: '', location: '', createdAt: '',
    likes: [], savedBy: [], origin: 'user', illustrative: false, media: [{ id: 'media', type: 'image', url: path }] }];
  state.stories = [{ id: 'same-story', authorId: author, image: path, caption: '', createdAt: '', seenBy: [], origin: 'user' }];
  state.messages = [{ id: 'same-message', senderId: author, recipientId: author, threadId: 'thread',
    text: '', createdAt: '', storyId: null, postId: null, readBy: [], origin: 'user',
    attachments: [{ id: 'attachment', type: 'image', url: path }] }];
  return { universeId, state };
}

for (const type of ['avatar', 'post', 'story', 'message'] as const) {
  test(`caller selects concrete ${type} association instead of another surface sharing the same object`, () => {
    const scope = fixture();
    const id = type === 'avatar' ? scope.state.characters[0].id : `same-${type}`;
    const source = mediaSourceFor(scope, path, { sourceType: type, sourceContentId: id });
    assert.deepEqual(source, { sourceUniverseId: 'studio', sourceCharacterId: scope.state.characters[0].id,
      sourceType: type, sourceContentId: id });
    const url = new URL(privateMediaUrl(path, source), 'https://echo.invalid');
    assert.equal(url.pathname, `/api/storage${path}`);
    assert.equal(url.searchParams.get('sourceUniverseId'), 'studio');
    assert.equal(url.searchParams.get('sourceContentId'), id);
    assert.equal(url.searchParams.has('ownerId'), false);
  });
}

test('switching universe with repeated IDs changes the URL and never reuses a global cached association', () => {
  const hint = { sourceType: 'post' as const, sourceContentId: 'same-post' };
  const urls = ['primary', 'studio', 'primary'].map(universe =>
    privateMediaUrl(path, mediaSourceFor(fixture(universe), path, hint)));
  assert.notEqual(urls[0], urls[1]);
  assert.equal(urls[0], urls[2]);
});

test('unpersisted drafts, missing scope and forged hints never invent an association', () => {
  const scope = fixture();
  assert.equal(mediaSourceFor(null, path), undefined);
  assert.equal(mediaSourceFor(scope, '/objects/uploads/new-draft'), undefined);
  assert.equal(mediaSourceFor(scope, path, { sourceType: 'post', sourceContentId: 'missing' }), undefined);
  assert.equal(mediaSourceFor(scope, path, { sourceType: 'post', sourceContentId: 'same-post', sourceCharacterId: 'foreign' }), undefined);
  assert.equal(privateMediaUrl('/objects/uploads/new-draft'), '/api/storage/objects/uploads/new-draft');
});

test('external/assets/blob/data URLs are unchanged and never receive identity parameters', () => {
  const scope = fixture();
  const source = mediaSourceFor(scope, path)!;
  for (const ref of ['asset:sample', 'blob:https://echo.invalid/1', 'data:image/png;base64,AA',
    'https://foreign.invalid/api/storage/objects/uploads/shared', '']) {
    assert.equal(mediaSourceFor(scope, ref), undefined);
    assert.equal(privateMediaUrl(ref, source), ref);
  }
});

test('local legacy URLs preserve fragments and deterministic context overwrites stale source fields', () => {
  const source: MediaSource = { sourceUniverseId: 'studio', sourceType: 'post',
    sourceContentId: 'same-post', sourceCharacterId: fixture().state.characters[0].id };
  const ref = `/api/storage${path}?sourceUniverseId=archived#t=0.1`;
  const url = new URL(privateMediaUrl(ref, source), 'https://echo.invalid');
  assert.equal(url.hash, '#t=0.1');
  assert.deepEqual(url.searchParams.getAll('sourceUniverseId'), ['studio']);
  assert.ok(mediaSourceFor(fixture(), ref));
});

test('every existing component media caller uses the scoped resolver, including previews and attachments', () => {
  const files = ['avatar', 'avatar-picker', 'photo-grid', 'post-media', 'story-viewer', 'highlights', 'dm-attachment-view']
    .map(name => `components/echo/${name}.tsx`).concat(['pages/create.tsx', 'pages/conversation.tsx', 'pages/notifications.tsx']);
  for (const file of files) {
    const code = readFileSync(new URL(`../src/${file}`, import.meta.url), 'utf8');
    assert.match(code, /useMediaResolver\(\)/, file);
    assert.doesNotMatch(code, /import\s*\{[^}]*\bresolveMedia\b[^}]*\}\s*from/, file);
  }
});
