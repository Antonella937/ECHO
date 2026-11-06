import test from 'node:test';
import assert from 'node:assert/strict';
import { SaveUniverseBody } from '@workspace/api-zod';
import { createSeedState } from '../src/store/seed';
import { upgradeAccounts, accountFormValues, editAccount, archiveAccount } from '../src/domain/accounts';
import { characterConfig, defaultCharacterConfig, validateCharacterConfig, deriveRoutineContext, duplicateCharacter, deletionBlockReason, deleteUnusedAccount, sectionStatus } from '../src/domain/character-core';
import { applyEvent, makeEvent } from '../src/domain/events';
import { mergeUniverse } from '../src/store/merge';
import { universeAccountError } from '../../api-server/src/lib/universeValidation';

const fixture = () => upgradeAccounts(createSeedState());
const row = (state: ReturnType<typeof fixture>, id = 'nela') => state.characters.find(c => c.id === id)!;
test('compatibilidad perezosa: perfiles e historial originales no se reescriben al abrir ficha', () => {
  const state = fixture(), original = structuredClone(state);
  for (const c of state.characters) {
    const config = characterConfig(c);
    assert.equal(config.basic.name, c.name); assert.equal(config.social.activity, 'medium');
    assert.equal(config.currentState.source, 'manual'); assert.equal(config.relationships.length, 0);
  }
  assert.deepEqual(state, original); assert.equal(state.characters.length, 9);
  assert.equal(sectionStatus(row(state), characterConfig(row(state))).social, false);
});
test('ficha completa y relación propietario separada de Nela atraviesan contrato sin perder datos', () => {
  let state = fixture(); const originalPosts = structuredClone(state.posts), c = row(state, 'mar'), config = characterConfig(c);
  config.basic = { name: 'Mar', age: 28, pronouns: 'ella', interests: ['foto'], likes: ['café'], dislikes: ['ruido'], notes: 'Biografía privada' };
  config.personality.description = 'Reservada, sarcástica, con una historia extensa.'; config.voice.speakingStyle = 'Rioplatense';
  config.relationships = ['owner', 'nela'].map((targetId, i) => ({ id: `r${i}`, targetId, preset: 'romantic_tension', customLabel: '', description: 'Amistad que puede cambiar', closeness: 60, trust: 70, attraction: 35, tension: 40 }));
  config.routine.entries = [{ id: 'once', title: 'Ensayo', activity: 'rehearsal', weekdays: [], start: '20:00', end: '23:00', location: 'Sala', recurrence: 'once', date: '2026-11-10', flexibility: 'high' }];
  config.social.minReplyMinutes = 20; config.social.maxReplyMinutes = 180;
  const at = '2026-11-01T12:00:00.000Z';
  config.memory.permanent = [{ id: 'm', text: 'Nunca abandona a sus amigos', targetId: null, createdAt: at, updatedAt: at, kind: 'manual', sourceId: null, promotedTo: null }];
  config.memory.relationships = [{ ...config.memory.permanent[0], id: 'rm', targetId: 'owner', text: 'Nos conocimos en un recital' }];
  state = editAccount(state, c.id, { ...accountFormValues(c), occupation: 'Fotógrafa', location: 'Buenos Aires', configuration: config });
  const parsed = SaveUniverseBody.parse({ state, expectedRevision: 0 });
  assert.equal(universeAccountError(parsed.state), null);
  assert.equal(parsed.state.characters.find(c => c.id === 'mar')!.configuration!.routine.entries[0].date, '2026-11-10');
  assert.equal(row(state, 'mar').configuration!.relationships.length, 2);
  assert.deepEqual(state.posts, originalPosts); assert.equal(row(state).configuration, undefined);
});
test('edición abierta combina secciones independientes sin pisar mensajes o cambios remotos', () => {
  const initial = fixture(), c = row(initial), expected = { ...accountFormValues(c), configuration: characterConfig(c) };
  const local = structuredClone(expected), remote = structuredClone(expected);
  local.configuration.personality.description = 'Mi descripción'; remote.configuration.voice.vocabulary = 'Mi vocabulario';
  const updated = editAccount(editAccount(initial, c.id, remote, expected), c.id, local, expected);
  assert.equal(row(updated).configuration!.personality.description, 'Mi descripción');
  assert.equal(row(updated).configuration!.voice.vocabulary, 'Mi vocabulario');
});
test('cambios incompatibles de una relación no se pisan y el estado previo queda intacto', () => {
  const state = fixture(), c = row(state), expected = { ...accountFormValues(c), configuration: characterConfig(c) };
  const a = structuredClone(expected), b = structuredClone(expected);
  a.configuration.personality.traits = ['Reservada']; b.configuration.personality.traits = ['Extrovertida'];
  const remote = editAccount(state, c.id, a, expected), original = structuredClone(remote);
  assert.throws(() => editAccount(remote, c.id, b, expected), /otro dispositivo/); assert.deepEqual(remote, original);
});
test('JSONB con claves reordenadas no marca presets ni genera conflictos falsos de arrays', () => {
  const state = fixture(), c = row(state), expected = { ...accountFormValues(c), configuration: characterConfig(c) };
  const reordered = (value: any): any => Array.isArray(value) ? value.map(reordered) : value && typeof value === 'object'
    ? Object.fromEntries(Object.entries(value).reverse().map(([k, v]) => [k, reordered(v)])) : value;
  const config = reordered(expected.configuration);
  assert.equal(sectionStatus(c, config).social, false);
  const next = editAccount(state, c.id, { ...expected, configuration: config }, expected);
  assert.deepEqual(row(next).configuration, config);
});
test('duplicar copia la ficha, no la audiencia, actividad reciente ni conexión externa', () => {
  const state = fixture(), original = row(state); original.configuration = characterConfig(original);
  original.configuration.personality.description = 'Reservada'; original.verified = true;
  const copy = duplicateCharacter(state, original.id, 'new');
  assert.equal(copy.configuration!.personality.description, 'Reservada'); assert.equal(copy.verified, false);
  assert.equal(copy.configuration!.memory.recent.length, 0); assert.equal(copy.providerRef.externalId, null);
  assert.notEqual(copy.handle, original.handle); assert.equal(state.characters.length, 9);
});
test('eliminación solo de cuentas sin uso; Nela, historial y referencias quedan protegidos', () => {
  const state = fixture();
  assert.ok(deletionBlockReason(state, 'nela')); assert.ok(deletionBlockReason(state, 'mar'));
  const copy = duplicateCharacter(state, 'mar', 'unused'); state.characters.push(copy); state.currentCharacterId = copy.id;
  assert.equal(deletionBlockReason(state, copy.id), null);
  const deleted = deleteUnusedAccount(state, copy.id);
  assert.equal(deleted.currentCharacterId, 'nela'); assert.deepEqual(deleted.posts, state.posts);
  row(state).configuration = characterConfig(row(state)); row(state).configuration!.currentState.companions = [copy.id];
  assert.ok(deletionBlockReason(state, copy.id)); assert.throws(() => deleteUnusedAccount(state, copy.id), /historial/);
  const archived = archiveAccount(state, copy.id, true);
  assert.equal(row(archived, copy.id).archived, true); assert.equal(row(archiveAccount(archived, copy.id, false), copy.id).archived, false);
});
test('rutina flexible admite noche que cruza día, siguiente evento y zona horaria sin actuar', () => {
  const config = defaultCharacterConfig();
  config.routine.entries = [{ id: 'sleep', title: 'Dormir', activity: 'sleep', weekdays: [1], start: '23:00', end: '07:00', location: 'Casa', recurrence: 'weekly', date: null, flexibility: 'high' }];
  const snapshot = structuredClone(config);
  const context = deriveRoutineContext(config, new Date('2026-11-03T05:00:00Z'));
  assert.equal(context.activity, 'Dormir'); assert.equal(context.location, 'Casa');
  assert.match(context.nextEvent!, /2026-11-09 23:00/); assert.deepEqual(config, snapshot);
  config.routine.timezone = 'America/New_York'; config.routine.entries[0].weekdays = [6];
  assert.equal(deriveRoutineContext(config, new Date('2026-11-01T05:30:00Z')).activity, 'Dormir');
  assert.equal(deriveRoutineContext(config, new Date('2026-11-01T06:30:00Z')).activity, 'Dormir');
  config.routine.entries = [{ ...config.routine.entries[0], title: 'Recital', recurrence: 'once', date: '2026-12-24' }];
  assert.match(deriveRoutineContext(config, new Date('2026-11-02T12:00:00Z')).nextEvent!, /Recital · 2026-12-24/);
});
test('validaciones rechazan zona, edad, rangos, fechas, referencias e ids de vínculos inválidos', () => {
  const state = fixture();
  const invalid = (change: (c: ReturnType<typeof defaultCharacterConfig>) => void) => {
    const config = defaultCharacterConfig(); change(config); assert.throws(() => validateCharacterConfig(config, state, 'nela'));
  };
  invalid(c => { c.basic.age = -2; }); invalid(c => { c.routine.timezone = 'Inventada/Lugar'; });
  invalid(c => { c.social.minReplyMinutes = 300; c.social.maxReplyMinutes = 20; });
  invalid(c => { c.currentState.companions = ['otro-owner']; });
  invalid(c => { c.memory.recentLimit = 2; });
  invalid(c => { c.personality.description = 'a'.repeat(24001); });
  invalid(c => { c.routine.entries = [{ id: 'r', title: 'X', activity: 'work', weekdays: [], start: '12:00', end: '13:00', location: '', recurrence: 'once', date: '2026-02-30', flexibility: 'high' }]; });
});
test('memoria reciente refleja solo actividad real, es acotada e idempotente y no recorta posts', () => {
  let state = fixture(); row(state).configuration = characterConfig(row(state)); row(state).configuration!.memory.recentLimit = 10;
  const count = state.posts.length, post = state.posts[0];
  for (let i = 0; i < 15; i++) state = applyEvent(state, makeEvent({ type: 'post.created', post: { ...post, id: `new${i}`, authorId: 'nela', caption: `Real ${i}` } }));
  assert.equal(row(state).configuration!.memory.recent.length, 10); assert.equal(state.posts.length, count + 15);
  assert.equal(row(state, 'mar').configuration, undefined);
  const event = makeEvent({ type: 'message.sent', message: { id: 'dm-real', threadId: 'mar__nela', senderId: 'nela', recipientId: 'mar', text: 'Mensaje real', createdAt: new Date().toISOString(), readBy: ['nela'], origin: 'user', postId: null, storyId: null } });
  state = applyEvent(state, event); const once = structuredClone(state); state = applyEvent(state, event);
  assert.deepEqual(state, once); assert.equal(row(state, 'mar').configuration!.memory.recent.length, 1);
  assert.match(row(state, 'mar').configuration!.memory.recent[0].text, /Mensaje real/);
});
test('dos dispositivos combinan recuerdos recientes reales y mantienen el límite sin borrar historia', () => {
  const state = fixture(), post = state.posts[0];
  const a = makeEvent({ type: 'post.created', post: { ...post, id: 'device-a', authorId: 'nela' } });
  const b = makeEvent({ type: 'post.created', post: { ...post, id: 'device-b', authorId: 'nela' } }); b.at = '2026-11-02T19:00:00Z'; a.at = '2026-11-02T18:00:00Z';
  const merged = mergeUniverse(state, applyEvent(state, a), applyEvent(state, b));
  assert.equal(merged.conflicts.length, 0); assert.equal(row(merged.state).configuration!.memory.recent.length, 2);
  assert.equal(merged.state.posts.length, state.posts.length + 2);
});
test('borrado sin uso contra nueva actividad de otro dispositivo conserva la cuenta y el historial', () => {
  const base = fixture(), copied = duplicateCharacter(base, 'mar', 'new-account');
  base.characters.push(copied);
  const local = deleteUnusedAccount(base, copied.id);
  const remote = applyEvent(base, makeEvent({ type: 'post.created', post: { ...base.posts[0], id: 'new-remote-post', authorId: copied.id } }));
  const merged = mergeUniverse(base, local, remote, { [`characters.${copied.id}`]: 'local' });
  assert.equal(row(merged.state, copied.id).archived, true);
  assert.ok(merged.state.posts.some(p => p.id === 'new-remote-post'));
  assert.equal(universeAccountError(SaveUniverseBody.parse({ state: merged.state, expectedRevision: 0 }).state), null);
});

test('catálogo gratuito: guarda voz elegida en el contrato sin alterar personalidad ni mensajes', () => {
  const state = fixture();
  const character = row(state, 'mar');
  const config = characterConfig(character);
  const originalPersonality = structuredClone(config.personality);
  const originalMessages = structuredClone(state.messages);
  config.voice.basicVoiceId = 'echo-f-02';
  const updated = editAccount(state, character.id, {
    ...accountFormValues(character),
    occupation: character.occupation,
    location: character.location,
    configuration: config,
  });
  const parsed = SaveUniverseBody.parse({ state: updated, expectedRevision: 0 });
  const saved = parsed.state.characters.find(c => c.id === character.id)!.configuration!;
  assert.equal(saved.voice.basicVoiceId, 'echo-f-02');
  assert.deepEqual(saved.personality, originalPersonality);
  assert.deepEqual(parsed.state.messages, originalMessages);
  const invalid = structuredClone(updated);
  invalid.characters.find(c => c.id === character.id)!.configuration!.voice.basicVoiceId = 'unknown-provider-voice';
  assert.equal(SaveUniverseBody.safeParse({ state: invalid, expectedRevision: 0 }).success, false);
});
