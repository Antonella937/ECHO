import test from 'node:test';
import assert from 'node:assert/strict';
import { normalizeSearch, searchHref, searchUniverse } from '../src/domain/universe-search';
import { createStarterUniverse } from '../src/store/create-starter-universe';
import type { Post } from '../src/domain/types';

function fixture(name = 'Lucía', marker = 'Ensayo') {
  const state = createStarterUniverse({ plan: 'creator', universeName: marker, displayName: name, username: normalizeSearch(name), bio: 'Bajista de música' });
  const post = (id: string, caption: string, location: string, date: string): Post => ({
    id, caption, location, authorId: 'nela', image: '', media: [], createdAt: date,
    likes: [], savedBy: [], origin: 'user', illustrative: false,
  });
  state.posts = [
    post('same-id', `${marker} #Café #Bajo`, 'Córdoba', '2026-11-03T10:00:00Z'),
    post('second', 'Otra noche #Café', 'Buenos Aires', '2026-11-04T10:00:00Z'),
    post('old', 'Memorias #Bajo', 'cordoba', '2026-11-02T10:00:00Z'),
  ];
  return state;
}

test('initial search returns no fabricated suggestions or results', () => {
  assert.deepEqual(searchUniverse(fixture()), { active: false, characters: [], posts: [], tags: [] });
});
test('normalizes accents, case, Unicode combining marks and whitespace', () => {
  assert.equal(normalizeSearch('  MÚSICA   Córdoba '), 'musica cordoba');
  assert.equal(searchUniverse(fixture(), 'LUCIA').characters.length, 1);
  assert.equal(searchUniverse(fixture(), 'musica').characters.length, 1);
});
test('matches handles and hashtag prefixes', () => {
  assert.equal(searchUniverse(fixture(), '@lucia').characters.length, 1);
  assert.deepEqual(searchUniverse(fixture(), '#cafe').tags, ['café']);
  assert.equal(searchUniverse(fixture(), '#cafe').posts.length, 2);
});
test('all search words must match; input is literal rather than regex', () => {
  assert.equal(searchUniverse(fixture(), 'ensayo bajo').posts.length, 1);
  assert.equal(searchUniverse(fixture(), 'ensayo inexistente').posts.length, 0);
  assert.equal(searchUniverse(fixture(), '.*').posts.length, 0);
});
test('location parameter is exact, accent-insensitive and limits posts and hashtags', () => {
  const result = searchUniverse(fixture(), '', ' CORDOBA ');
  assert.deepEqual(result.posts.map(post => post.id), ['same-id', 'old']);
  assert.deepEqual(result.characters, []);
  assert.deepEqual(result.tags, ['bajo', 'café']);
  assert.equal(searchUniverse(fixture(), '', 'Córdo').posts.length, 0);
});
test('query and location filters combine', () => {
  assert.deepEqual(searchUniverse(fixture(), 'ensayo', 'Córdoba').posts.map(post => post.id), ['same-id']);
  assert.equal(searchUniverse(fixture(), 'otra', 'Córdoba').posts.length, 0);
});
test('no results and empty universe are safe', () => {
  const state = fixture();
  assert.equal(searchUniverse(state, 'zzzz').posts.length, 0);
  state.characters = []; state.posts = [];
  assert.deepEqual(searchUniverse(state, 'lucia'), { active: true, characters: [], posts: [], tags: [] });
});
test('archived characters are excluded from discovery; existing posts remain searchable', () => {
  const state = fixture();
  state.characters[0].archived = true;
  assert.equal(searchUniverse(state, 'lucia').characters.length, 0);
  assert.equal(searchUniverse(state, 'ensayo').posts.length, 1);
});
test('unknown author posts cannot leak into results', () => {
  const state = fixture();
  state.posts[0].authorId = 'foreign-author';
  assert.equal(searchUniverse(state, 'ensayo').posts.length, 0);
});
test('switching snapshots with colliding IDs never reuses previous universe results', () => {
  const primary = fixture('Lucía', 'Primary');
  const studio = fixture('Mónica', 'Studio');
  assert.equal(searchUniverse(primary, 'primary').posts.length, 1);
  assert.equal(searchUniverse(studio, 'primary').posts.length, 0);
  assert.equal(searchUniverse(studio, 'studio').posts[0].id, 'same-id');
  assert.equal(searchUniverse(primary, 'primary').posts.length, 1);
  assert.equal(searchUniverse(studio, 'Lucía').characters.length, 0);
});
test('separate owner snapshots do not share results or mutate inputs', () => {
  const a = fixture('Ana', 'OwnerA');
  const b = fixture('Bea', 'OwnerB');
  const before = JSON.stringify([a, b]);
  assert.equal(searchUniverse(a, 'OwnerB').posts.length, 0);
  assert.equal(searchUniverse(b, 'OwnerA').posts.length, 0);
  searchUniverse(a, 'cafe');
  assert.equal(JSON.stringify([a, b]), before);
});
test('URL preserves encoded location/query and clears filters independently', () => {
  const url = new URL(searchHref('café & #bajo', 'Córdoba / Centro'), 'https://example.test');
  assert.equal(url.pathname, '/search');
  assert.equal(url.searchParams.get('q'), 'café & #bajo');
  assert.equal(url.searchParams.get('location'), 'Córdoba / Centro');
  assert.equal(searchHref(), '/search');
  assert.equal(new URL(searchHref('', 'Córdoba'), url).searchParams.has('q'), false);
});
