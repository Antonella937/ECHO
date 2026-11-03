import type { Character, Post, SocialState } from './types';
import { characterConfig, sameCharacterValue, validateCharacterConfig } from './character-core';

export type AccountInput = Pick<Character, 'name' | 'handle' | 'bio' | 'avatar'> &
  Partial<Pick<Character, 'accountType' | 'verified' | 'displayMetrics' | 'occupation' | 'location' | 'configuration'>>;
export const accountTypes = { personal: 'Personal', band: 'Banda', venue: 'Lugar', organization: 'Organización' } as const;
const catalog = [
  ['pretty-violence', 'Pretty Violence', 'prettyviolence', 'band'],
  ['false-halo', 'False Halo', 'falsehalo', 'band'],
  ['saint-vulture', 'Saint Vulture', 'saintvulture', 'band'],
  ['stray-kids', 'Stray Kids', 'straykids', 'band'],
  ['the-hollow', 'The Hollow', 'thehollow', 'venue'],
  ['dead-static', 'Dead Static', 'deadstatic', 'band'],
] as const;
export function officialAccounts(): Character[] {
  return catalog.map(([id, name, handle, accountType]) => ({
    id: `official-${id}`, name, handle, accountType, verified: true, archived: false,
    bio: `Cuenta oficial de ${name}.`, occupation: accountTypes[accountType], location: '',
    avatar: `asset:official-${id}`,
    providerRef: { provider: 'mock', externalId: null, status: 'not_connected', lastSyncAt: null },
    identity: { provider: 'mock', referenceImages: [], seed: 0, appearance: '', styleNotes: '', updatedAt: '2026-01-01T00:00:00.000Z' },
  }));
}
/** Additive, idempotent upgrade: no existing account or content is replaced. */
export function upgradeAccounts(state: SocialState): SocialState {
  if ((state.accountCatalogVersion ?? 0) >= 1) return state;
  const characters = [...state.characters];
  for (const account of officialAccounts()) {
    if (!characters.some(c => c.id === account.id || c.handle.toLowerCase().replace(/^@/, '') === account.handle))
      characters.push(account);
  }
  return { ...state, characters, accountCatalogVersion: 1 };
}
export function validateAccount(input: AccountInput, state: SocialState, id?: string): AccountInput {
  const handle = input.handle.trim().replace(/^@/, '').toLowerCase();
  const name = input.name.trim();
  if (!/^[a-z0-9_][a-z0-9_.]{0,29}$/.test(handle)) throw Error('El @username debe tener entre 1 y 30 letras, números, puntos o guiones bajos.');
  if (!name || name.length > 80) throw Error('El nombre debe tener entre 1 y 80 caracteres.');
  if (input.bio.length > 500) throw Error('La bio admite hasta 500 caracteres.');
  if (!input.avatar) throw Error('Selecciona un avatar.');
  if (state.characters.some(c => c.id !== id && c.handle.toLowerCase().replace(/^@/, '') === handle))
    throw Error('Ese @username ya existe en tu universo, incluso entre las cuentas archivadas.');
  if (input.accountType && !Object.hasOwn(accountTypes, input.accountType)) throw Error('Tipo de cuenta inválido.');
  validateMetrics(input.displayMetrics);
  if (input.configuration) validateCharacterConfig(input.configuration, state, id);
  return { ...input, name, handle };
}
export function validateMetrics(metrics?: Record<string, number | null | undefined>) {
  if (metrics && Object.values(metrics).some(v => v != null && (!Number.isSafeInteger(v) || v < 0 || v > 1e12)))
    throw Error('Las cifras deben ser enteros entre 0 y 1.000.000.000.000, o quedar vacías.');
}
export function shownCount(base: number | null | undefined, real: number) { return (base ?? 0) + real; }
export function formatCount(value: number) {
  return new Intl.NumberFormat('es', { notation: value >= 10000 ? 'compact' : 'standard', maximumFractionDigits: 1 }).format(value);
}
export function accountFormValues(c: AccountInput): AccountInput {
  return { name: c.name, handle: c.handle, bio: c.bio, avatar: c.avatar,
    occupation: c.occupation ?? '', location: c.location ?? '', configuration: c.configuration,
    accountType: c.accountType ?? 'personal', verified: c.verified ?? false,
    displayMetrics: { followers: c.displayMetrics?.followers ?? null, following: c.displayMetrics?.following ?? null } };
}
function formField<T>(current: T, input: T, original: T): T {
  if (Object.is(input, original)) return current;
  if (!Object.is(current, original) && !Object.is(current, input))
    throw Error('Este campo cambió desde que abriste el editor. No sobrescribimos nada: vuelve a abrir el perfil para revisar la versión más reciente.');
  return input;
}
/** Three-way leaf merge for rich forms, preserving unchanged and concurrent sections. */
function configField(current: unknown, input: unknown, original: unknown): unknown {
  const same = sameCharacterValue;
  if (same(input, original)) return current;
  if (same(current, original) || same(current, input)) return input;
  if (current && input && original && !Array.isArray(input) && typeof input === 'object' && typeof current === 'object' && typeof original === 'object') {
    const c = current as Record<string, unknown>, i = input as Record<string, unknown>, o = original as Record<string, unknown>;
    return Object.fromEntries(Object.keys(i).map(key => [key, configField(c[key], i[key], o[key])]));
  }
  throw Error('Esta sección cambió en otro dispositivo. Tu borrador sigue abierto: revisá la versión más reciente antes de guardar.');
}
export function editAccount(state: SocialState, id: string, input: AccountInput, expected?: AccountInput): SocialState {
  const current = state.characters.find(c => c.id === id);
  if (!current) throw Error('La cuenta ya no existe.');
  let candidate = input;
  if (expected) {
    const now = accountFormValues(current), before = accountFormValues(expected), wanted = accountFormValues(input);
    candidate = {
      name: formField(now.name, wanted.name, before.name),
      handle: formField(now.handle, wanted.handle, before.handle),
      bio: formField(now.bio, wanted.bio, before.bio),
      avatar: formField(now.avatar, wanted.avatar, before.avatar),
      accountType: formField(now.accountType, wanted.accountType, before.accountType),
      verified: formField(now.verified, wanted.verified, before.verified),
      occupation: formField(now.occupation, input.occupation ?? now.occupation, expected.occupation ?? now.occupation),
      location: formField(now.location, input.location ?? now.location, expected.location ?? now.location),
      configuration: input.configuration
        ? configField(characterConfig(current), input.configuration, expected.configuration ?? characterConfig({ ...current, configuration: undefined })) as Character['configuration']
        : current.configuration,
      displayMetrics: {
        followers: formField(now.displayMetrics?.followers, wanted.displayMetrics?.followers, before.displayMetrics?.followers),
        following: formField(now.displayMetrics?.following, wanted.displayMetrics?.following, before.displayMetrics?.following),
      },
    };
  }
  const patch = validateAccount(candidate, state, id);
  return { ...state, characters: state.characters.map(c => c.id === id ? { ...c, ...patch } : c) };
}
export function archiveAccount(state: SocialState, id: string, archived: boolean): SocialState {
  if (id === 'nela') {
    if (!state.creatorSetup) throw Error('La identidad principal no se puede archivar.');
    const mainName = state.creatorSetup ? state.characters.find((character) => character.id === id)?.name ?? 'La identidad principal' : 'Nela';
    throw Error(`${mainName} es la identidad principal y no se puede archivar.`);
  }
  if (!state.characters.some(c => c.id === id)) throw Error('La cuenta ya no existe.');
  return {
    ...state, currentCharacterId: archived && state.currentCharacterId === id ? 'nela' : state.currentCharacterId,
    characters: state.characters.map(c => c.id === id ? { ...c, archived } : c),
  };
}
export type PostMetrics = NonNullable<Post['displayMetrics']>;
export function editPostMetrics(state: SocialState, id: string, metrics: PostMetrics, expected?: PostMetrics): SocialState {
  validateMetrics(metrics);
  return { ...state, posts: state.posts.map(post => {
    if (post.id !== id) return post;
    const next = { ...post.displayMetrics };
    for (const key of ['likes', 'comments', 'views'] as const) {
      if (!(key in metrics)) continue;
      next[key] = expected ? formField(post.displayMetrics?.[key] ?? null, metrics[key] ?? null, expected[key] ?? null) : metrics[key];
    }
    return { ...post, displayMetrics: next };
  }) };
}
