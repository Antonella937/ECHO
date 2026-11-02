import { test } from 'node:test';
import assert from 'node:assert/strict';
import { accountFormValues, archiveAccount, editAccount, editPostMetrics, officialAccounts, shownCount, upgradeAccounts, validateAccount } from '../src/domain/accounts';
import { applyEvent, makeEvent } from '../src/domain/events';
import { mergeUniverse } from '../src/store/merge';
import type { SocialState } from '../src/domain/types';

function fixture(): SocialState {
  const c = officialAccounts()[0];
  return {
    version: 1, currentCharacterId: 'nela', characters: ['nela', 'mar', 'noah'].map(id => ({
      ...structuredClone(c), id, name: id, handle: id, accountType: 'personal', verified: false, avatar: `asset:${id}-avatar`,
    })), posts: [{ id: 'p', authorId: 'nela', caption: 'original', image: 'asset:nela-avatar', likes: ['mar'], savedBy: [], location: '', illustrative: true, origin: 'user', createdAt: '2026-01-01T00:00:00Z' }],
    follows: { mar: ['nela'] }, comments: [], stories: [], messages: [], notifications: [],
  };
}
test('upgrade aditivo: nueve cuentas, seis oficiales verificadas y ningún cambio al historial', () => {
  const original = fixture(), state = upgradeAccounts(original);
  assert.equal(state.characters.length, 9);
  assert.equal(state.characters.filter(c => c.verified).length, 6);
  for (const key of ['posts', 'comments', 'stories', 'messages', 'follows'] as const)
    assert.deepEqual(state[key], original[key]);
  assert.deepEqual(upgradeAccounts(state), state);
  assert.equal(original.characters.length, 3);
});
test('upgrade no sobrescribe una banda existente con el mismo username', () => {
  const original = fixture(); const customized = { ...officialAccounts()[0], id: 'custom-pv', name: 'Mi PV' };
  original.characters.push(customized);
  const state = upgradeAccounts(original);
  assert.equal(state.characters.length, 9);
  assert.equal(state.characters.find(c => c.handle === 'prettyviolence')?.name, 'Mi PV');
});
test('Nela, Mar, Noah y cuentas oficiales pueden editar todos los campos públicos', () => {
  let state = upgradeAccounts(fixture());
  for (const c of [...state.characters]) {
    state = editAccount(state, c.id, {
      ...c, name: `${c.name} editado`, handle: `${c.handle}_nuevo`, bio: 'Una bio nueva',
      avatar: 'asset:account-default', verified: !c.verified,
    });
    const edited = state.characters.find(a => a.id === c.id)!;
    assert.equal(edited.name, `${c.name} editado`); assert.equal(edited.avatar, 'asset:account-default');
    assert.equal(edited.bio, 'Una bio nueva'); assert.equal(edited.verified, !c.verified);
  }
  assert.equal(state.posts[0].caption, 'original');
});
test('username normalizado, único y validación de nombres, bios y métricas', () => {
  const s = fixture(), input = { ...s.characters[0], handle: ' @NUEVA ' };
  assert.equal(validateAccount(input, s, 'nela').handle, 'nueva');
  for (const invalid of [
    { ...input, handle: 'mar' }, { ...input, handle: 'espacio no' },
    { ...input, name: '' }, { ...input, bio: 'a'.repeat(501) },
    { ...input, displayMetrics: { followers: -1 } }, { ...input, displayMetrics: { followers: 1.2 } },
  ]) assert.throws(() => validateAccount(invalid, s, 'nela'));
});
test('métricas visuales no crean likes, comentarios ni seguidores sintéticos', () => {
  const s = fixture();
  const next = editPostMetrics(s, 'p', { likes: 500000, comments: 200 });
  assert.equal(shownCount(next.posts[0].displayMetrics?.likes, next.posts[0].likes.length), 500001);
  assert.deepEqual(next.posts[0].likes, ['mar']); assert.deepEqual(next.comments, []);
  const account = editAccount(next, 'nela', { ...s.characters[0], displayMetrics: { followers: 900000, following: 100 } });
  assert.deepEqual(account.follows, s.follows);
  assert.equal(editPostMetrics(next, 'p', { likes: null }).posts[0].displayMetrics?.likes, null);
});
test('archivo reversible conserva todas las referencias e impide archivar Nela', () => {
  const s = upgradeAccounts(fixture()); s.currentCharacterId = 'mar';
  const archived = archiveAccount(s, 'mar', true);
  assert.equal(archived.currentCharacterId, 'nela');
  assert.deepEqual(archived.posts, s.posts);
  assert.equal(applyEvent(archived, makeEvent({ type: 'identity.switched', characterId: 'mar' })).currentCharacterId, 'nela');
  const restored = archiveAccount(archived, 'mar', false);
  assert.equal(applyEvent(restored, makeEvent({ type: 'identity.switched', characterId: 'mar' })).currentCharacterId, 'mar');
  assert.throws(() => archiveAccount(s, 'nela', true));
  assert.equal(upgradeAccounts(archived).characters.find(c => c.id === 'mar')?.archived, true);
});
test('cualquier cuenta oficial puede ser la autora de posts y regresar a Nela', () => {
  let s = upgradeAccounts(fixture());
  for (const c of officialAccounts()) {
    s = applyEvent(s, makeEvent({ type: 'identity.switched', characterId: c.id }));
    s = applyEvent(s, makeEvent({ type: 'post.created', post: { ...s.posts[0], id: `post-${c.id}`, authorId: s.currentCharacterId } }));
    assert.equal(s.posts.find(p => p.id === `post-${c.id}`)?.authorId, c.id);
  }
  s = applyEvent(s, makeEvent({ type: 'identity.switched', characterId: 'nela' }));
  assert.equal(s.currentCharacterId, 'nela');
});
test('formularios abiertos no sobrescriben ediciones remotas; campos distintos se combinan', () => {
  const s = fixture(), before = accountFormValues(s.characters[0]);
  const remote = editAccount(s, 'nela', { ...before, bio: 'Bio de otro dispositivo' });
  const result = editAccount(remote, 'nela', { ...before, name: 'Nuevo nombre' }, before);
  assert.equal(result.characters[0].bio, 'Bio de otro dispositivo');
  assert.equal(result.characters[0].name, 'Nuevo nombre');
  assert.throws(() => editAccount(remote, 'nela', { ...before, bio: 'Otra bio' }, before), /cambió/);
  const metrics = editPostMetrics(s, 'p', { likes: 300 });
  assert.throws(() => editPostMetrics(metrics, 'p', { likes: 500 }, {}), /cambió/);
});
test('archivo remoto de la identidad activa cambia a Nela sin perder posts', () => {
  const base = fixture(); base.currentCharacterId = 'mar';
  const remote = archiveAccount(base, 'mar', true);
  const merged = mergeUniverse(base, base, remote);
  assert.equal(merged.state.currentCharacterId, 'nela');
  assert.deepEqual(merged.state.posts, base.posts);
});
