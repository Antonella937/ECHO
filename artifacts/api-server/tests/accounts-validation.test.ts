import { test } from 'node:test';
import assert from 'node:assert/strict';
import { SaveUniverseBody, SaveUniverseResponse } from '@workspace/api-zod';
import { universeAccountError } from '../src/lib/universeValidation';

function input() {
  const account = { id: 'nela', handle: 'nela', name: 'Nela', bio: '', occupation: '', location: '',
    avatar: 'asset:nela-avatar', verified: false, accountType: 'personal', displayMetrics: { followers: 1000000, following: null },
    identity: { provider: 'mock', referenceImages: [], seed: 0, appearance: '', styleNotes: '', updatedAt: '2026-01-01T00:00:00Z' },
    providerRef: { provider: 'mock', externalId: null, status: 'not_connected', lastSyncAt: null } };
  return { expectedRevision: 1, state: { version: 1, currentCharacterId: 'nela', characters: [account], follows: {}, posts: [], comments: [], stories: [], messages: [], notifications: [] } };
}
test('contrato conserva campos de cuentas y revisión completa para sincronización', () => {
  const parsed = SaveUniverseBody.parse(input());
  assert.equal(universeAccountError(parsed.state), null);
  const response = SaveUniverseResponse.parse({ state: parsed.state, revision: 2 });
  assert.equal(response.revision, 2);
  assert.equal(response.state?.characters[0].displayMetrics?.followers, 1000000);
  assert.throws(() => SaveUniverseResponse.parse({ state: parsed.state }));
});
test('servidor rechaza métricas negativas, verificación inválida y tipo desconocido', () => {
  const body = input();
  body.state.characters[0].displayMetrics.followers = -1;
  assert.equal(SaveUniverseBody.safeParse(body).success, false);
  const invalid = input() as any; invalid.state.characters[0].verified = 'sí';
  assert.equal(SaveUniverseBody.safeParse(invalid).success, false);
  invalid.state.characters[0].verified = true; invalid.state.characters[0].accountType = 'admin';
  assert.equal(SaveUniverseBody.safeParse(invalid).success, false);
});
test('servidor rechaza usernames/ids duplicados y archivar identidad principal', () => {
  const state = SaveUniverseBody.parse(input()).state;
  state.characters.push({ ...state.characters[0], id: 'otra' });
  assert.match(universeAccountError(state)!, /username/);
  state.characters.pop(); state.characters[0].archived = true;
  assert.match(universeAccountError(state)!, /principal/);
});
