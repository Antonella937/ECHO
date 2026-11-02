import { test } from 'node:test';
import assert from 'node:assert/strict';
import { mergeUniverse, same } from '../src/store/merge';
import { UniverseSync } from '../src/store/synchronization';
import { RevisionConflict, type Recovery } from '../src/store/persistence';
import { applyEvent, makeEvent } from '../src/domain/events';
import type { SocialState, Post } from '../src/domain/types';

const clone = <T>(v: T): T => structuredClone(v);
function fixture(): SocialState {
  const character = (id: string) => ({
    id, name: id, handle: id, bio: '', occupation: '', location: '', avatar: 'asset:nela-avatar',
    providerRef: { provider: 'mock', externalId: null, status: 'not_connected', lastSyncAt: null },
    identity: { provider: 'mock', referenceImages: [], seed: 1, appearance: '', styleNotes: '', updatedAt: '2026-01-01T00:00:00Z' },
  });
  return {
    version: 1, currentCharacterId: 'nela', characters: ['nela', 'mar', 'noah'].map(character),
    follows: {}, posts: [], comments: [], stories: [], messages: [], notifications: [],
  } as SocialState;
}
const post = (id: string, caption = id): Post => ({
  id, caption, authorId: 'nela', image: 'asset:nela-avatar', location: '', likes: [], savedBy: [],
  createdAt: '2026-01-01T00:00:00Z', origin: 'user', illustrative: false,
});

function harness(initial = fixture(), legacy: SocialState | null = null) {
  let server = clone(initial), revision = 1, saves = 0, stale = 0, verifies = 0, offline = false, failVerify = false;
  const recoveries = new Map<string, Recovery>(), receipts = new Set<string>(), converted = new Map<string, SocialState>(), claims = new Map<string, string>();
  const original = clone(legacy);
  const io = {
    async loadUniverse() { if (offline) throw Error('sin conexión'); return { state: clone(server), revision }; },
    async saveUniverse(state: SocialState, expected: number) {
      if (offline) throw Error('sin conexión');
      if (expected !== revision) { stale++; throw new RevisionConflict(); }
      server = clone(state); revision++; saves++; return { state: clone(server), revision };
    },
    async loadRecovery(owner: string) { return clone(recoveries.get(owner) ?? null); },
    async saveRecovery(owner: string, value: Recovery) { recoveries.set(owner, clone(value)); },
    async loadLegacyState() { return clone(legacy); },
    async fingerprint(s: SocialState) { return JSON.stringify(s); },
    async importedBy(owner: string, hash: string) { return receipts.has(owner + hash); },
    async legacyOwner(hash: string) { return claims.get(hash) ?? null; },
    async claimLegacy(owner: string, hash: string) {
      if (claims.has(hash) && claims.get(hash) !== owner) throw Error('otro propietario');
      claims.set(hash, owner);
    },
    async markImported(owner: string, hash: string) { receipts.add(owner + hash); },
    async cachedMigration(owner: string, hash: string) { return clone(converted.get(owner + hash) ?? null); },
    async cacheMigration(owner: string, hash: string, s: SocialState) { converted.set(owner + hash, clone(s)); },
    async moveLocalImagesToPrivateStorage(s: SocialState) { return clone(s); },
    async verifySavedUniverse(s: SocialState) {
      verifies++;
      if (failVerify) throw Error('foto no legible');
      assert.ok(same(s, server), 'se relee el servidor antes de marcar la importación');
    },
  };
  const device = (owner = 'owner-a') => new UniverseSync(owner, fixture, () => {}, io);
  return {
    device, io, recoveries, receipts, original, legacy: () => legacy,
    server: () => clone(server), stats: () => ({ saves, stale, verifies }),
    offline: (v: boolean) => { offline = v; }, failVerify: (v: boolean) => { failVerify = v; },
  };
}

test('dos dispositivos conservan posts, comentarios, stories y DMs simultáneos', async () => {
  const h = harness(); const a = h.device(), b = h.device();
  await Promise.all([a.initialize(), b.initialize()]);
  a.edit(s => ({ ...s, posts: [post('a'), ...s.posts] }));
  b.edit(s => ({
    ...s, posts: [post('b'), ...s.posts],
    stories: [{ id: 's', authorId: 'mar', image: 'asset:mar-avatar', caption: '', createdAt: '2026-01-01', seenBy: [], origin: 'user' }],
    messages: [{ id: 'm', threadId: 'mar__nela', senderId: 'mar', recipientId: 'nela', text: 'hola', createdAt: '2026-01-01', readBy: ['mar'], storyId: null, postId: null, origin: 'user' }],
  }));
  await Promise.all([a.sync(), b.sync()]);
  await a.sync(); await b.sync();
  assert.deepEqual(new Set(h.server().posts.map(p => p.id)), new Set(['a', 'b']));
  assert.equal(h.server().messages.length, 1); assert.equal(h.server().stories.length, 1);
  a.edit(s => ({ ...s, comments: [{ id: 'c', postId: 'a', authorId: 'nela', text: 'hola', createdAt: '2026-01-01', parentId: null, replyToAuthorId: null, likes: [], origin: 'user' }] }));
  await a.sync(); await b.sync();
  assert.equal(b.view.state?.comments.length, 1);
  assert.ok(h.stats().stale >= 1, 'un guardado obsoleto se rechaza y se combina');
});

test('importación explícita combina remoto, conserva copia local, verifica y no duplica al repetir', async () => {
  const local = fixture(); local.posts.push(post('local')); local.comments = [];
  const remote = fixture(); remote.posts.push(post('remoto'));
  const h = harness(remote, local), d = h.device();
  await d.initialize();
  assert.ok(d.view.legacyAvailable);
  assert.equal(h.server().posts.length, 1, 'no se importa sin consentimiento');
  await d.importLegacy();
  assert.equal(d.view.conflicts.length, 0);
  assert.equal(h.server().posts.length, 2);
  assert.ok(d.view.importVerified);
  assert.ok(h.stats().verifies > 0);
  assert.deepEqual(h.legacy(), h.original, 'la copia antigua nunca se elimina ni modifica');
  await d.importLegacy();
  assert.equal(h.server().posts.length, 2);
});

test('fallo al verificar una foto conserva original y no marca importación completa', async () => {
  const local = fixture(); local.posts.push(post('local'));
  const h = harness(fixture(), local); h.failVerify(true);
  const d = h.device(); await d.initialize(); await d.importLegacy();
  assert.match(d.view.error!, /foto/);
  assert.equal(h.receipts.size, 0);
  assert.deepEqual(h.legacy(), local);
  h.failVerify(false); await d.sync(); await d.importLegacy();
  assert.ok(d.view.importVerified); assert.equal(h.server().posts.length, 1);
});

test('dos ediciones incompatibles requieren elección, nunca un reemplazo silencioso', async () => {
  const s = fixture(); s.posts.push(post('p', 'original'));
  const h = harness(s), a = h.device(), b = h.device();
  await a.initialize(); await b.initialize();
  a.edit(s => ({ ...s, posts: s.posts.map(p => ({ ...p, caption: 'A' })) }));
  b.edit(s => ({ ...s, posts: s.posts.map(p => ({ ...p, caption: 'B' })) }));
  await a.sync(); await b.sync();
  assert.equal(h.server().posts[0].caption, 'A');
  assert.equal(b.view.conflicts[0].path, 'posts.p.caption');
  b.resolve({ 'posts.p.caption': 'local' }); await b.sync();
  assert.equal(h.server().posts[0].caption, 'B');
});

test('un cambio remoto posterior invalida decisiones sobre una versión anterior', async () => {
  const base = fixture(); base.posts.push(post('p'));
  const h = harness(base), a = h.device(), b = h.device();
  await a.initialize(); await b.initialize();
  a.edit(s => ({ ...s, posts: [post('p', 'A')] })); await a.sync();
  b.edit(s => ({ ...s, posts: [post('p', 'B')] })); await b.sync();
  a.edit(s => ({ ...s, posts: [post('p', 'A2')] })); await a.sync();
  b.resolve({ 'posts.p.caption': 'local' }); await b.sync();
  assert.equal(h.server().posts[0].caption, 'A2');
  assert.equal(b.view.conflicts.length, 1);
});

test('borrado de post frente a comentario nuevo pide resolver la eliminación', () => {
  const base = fixture(); base.posts.push(post('p'));
  const local = clone(base); local.comments.push({ id: 'c', postId: 'p', authorId: 'nela', text: 'nuevo', createdAt: '', parentId: null, replyToAuthorId: null, likes: [], origin: 'user' });
  const remote = clone(base); remote.posts = [];
  const result = mergeUniverse(base, local, remote);
  assert.equal(result.conflicts[0].path, 'posts.p');
  const keep = mergeUniverse(base, local, remote, { 'posts.p': 'local' });
  assert.equal(keep.state.posts.length, 1); assert.equal(keep.state.comments.length, 1);
});

test('likes, lecturas y guardados se combinan sin duplicados', () => {
  const base = fixture(); base.posts.push(post('p'));
  const a = clone(base), b = clone(base);
  a.posts[0].likes = ['mar']; b.posts[0].likes = ['noah'];
  const m = mergeUniverse(base, a, b);
  assert.equal(m.conflicts.length, 0);
  assert.deepEqual(new Set(m.state.posts[0].likes), new Set(['mar', 'noah']));
});

test('cambios offline sobreviven a recarga y se sincronizan sin perder datos remotos', async () => {
  const h = harness(), a = h.device(); await a.initialize();
  h.offline(true); a.edit(s => ({ ...s, posts: [post('offline')] })); await a.sync();
  assert.match(a.view.error!, /conexión/); a.stop();
  h.offline(false);
  const b = h.device(); await b.initialize();
  assert.equal(h.server().posts[0].id, 'offline');
});

test('Nela inicial, identidad activa separada y cambios de personaje no borran contenido', async () => {
  const h = harness(), a = h.device(); await a.initialize();
  assert.equal(a.view.state?.currentCharacterId, 'nela');
  a.edit(s => applyEvent(s, makeEvent({ type: 'identity.switched', characterId: 'mar' })));
  await a.sync();
  assert.equal(a.view.state?.currentCharacterId, 'mar');
  assert.ok(h.recoveries.has('owner-a'));
  const other = h.device('owner-b');
  // Recovery is scoped by login owner, not the active character.
  assert.equal(await h.io.loadRecovery('owner-b'), null);
  other.stop();
});

test('JSONB key order no provoca guardados repetidos ni conflictos falsos', () => {
  assert.ok(same({ a: 1, b: { c: 3, d: 4 } }, { b: { d: 4, c: 3 }, a: 1 }));
});
test('un dispositivo inactivo no produce un bucle de guardados', async () => {
  const h = harness(), a = h.device(), b = h.device();
  await a.initialize(); await b.initialize();
  a.edit(s => ({ ...s, currentCharacterId: 'mar' })); await a.sync();
  const before = h.stats().saves;
  await b.sync(); await a.sync(); await b.sync();
  assert.equal(h.stats().saves, before);
  assert.equal(b.view.state?.currentCharacterId, 'nela');
});
test('la copia antigua vinculada a un propietario no se ofrece a otra cuenta', async () => {
  const local = fixture(); local.posts.push(post('antiguo'));
  const h = harness(fixture(), local), a = h.device('owner-a');
  await a.initialize(); await a.importLegacy();
  const b = h.device('owner-b'); await b.initialize();
  assert.equal(b.view.legacyAvailable, false);
});
