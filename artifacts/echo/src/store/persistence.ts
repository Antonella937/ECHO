import type { SocialState } from '@/domain/types';
import { customFetch, ApiError, type UniverseInput } from '@workspace/api-client-react';

const DB_NAME = 'echo-local';
const STORE = 'kv';
const KEY = 'social-state';
const LS_KEY = 'echo:social-state';
const BACKEND_KEY = 'echo:storage-backend';

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    if (!('indexedDB' in window)) return reject(new Error('IndexedDB no disponible'));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => req.result.createObjectStore(STORE);
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error ?? new Error('No se pudo abrir IndexedDB'));
  });
}

function tx<T>(mode: IDBTransactionMode, fn: (s: IDBObjectStore) => IDBRequest): Promise<T> {
  return openDb().then(
    (db) =>
      new Promise<T>((resolve, reject) => {
        const t = db.transaction(STORE, mode);
        const r = fn(t.objectStore(STORE));
        t.oncomplete = () => {
          resolve(r.result as T);
          db.close();
        };
        t.onerror = () => reject(t.error ?? new Error('Error de almacenamiento'));
        t.onabort = () => reject(t.error ?? new Error('Almacenamiento lleno o bloqueado'));
      }),
  );
}

export async function loadLegacyState(): Promise<SocialState | null> {
  // A failed IndexedDB write may leave an older snapshot behind. Once a
  // fallback write succeeds, that localStorage snapshot is authoritative.
  if (localStorage.getItem(BACKEND_KEY) === 'localstorage') {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      return JSON.parse(raw) as SocialState;
    }
  }
  try {
    const s = await tx<SocialState | undefined>('readonly', (st) => st.get(KEY));
    return s ?? null;
  } catch {
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SocialState) : null;
  }
}

export interface UniverseEnvelope { state: SocialState | null; revision: number }
const ACTIVE_UNIVERSE_PREFIX = 'echo:active-universe:';
export function getActiveUniverseId(ownerId: string): string {
  return localStorage.getItem(`${ACTIVE_UNIVERSE_PREFIX}${ownerId}`) || 'primary';
}
export function setActiveUniverseId(ownerId: string, universeId: string): void {
  localStorage.setItem(`${ACTIVE_UNIVERSE_PREFIX}${ownerId}`, universeId);
}
export class RevisionConflict extends Error {}

/** Use the same Render API origin and Clerk bearer token as generated API hooks. */
export async function loadUniverse(universeId = 'primary'): Promise<UniverseEnvelope> {
  return customFetch<UniverseEnvelope>(`/api/universe?${new URLSearchParams({ universeId })}`, {
    method: 'GET', responseType: 'json', cache: 'no-store',
  });
}

/** Lightweight profile projection for large universes. Does not include character memories. */
export interface CharacterPageItem {
  id: string;
  personId: string;
  handle: string;
  name: string;
  occupation: string;
  bio: string;
  avatar: string;
  accountType: string;
  verified: boolean;
  privateAccount: boolean;
  displayMetrics: { followers?: number | null; following?: number | null } | null;
}
export interface CharacterPage {
  characters: CharacterPageItem[];
  total: number;
  nextOffset: number | null;
  revision: number;
}

/** Fetch a bounded page. Existing full-state synchronization remains unchanged. */
export async function loadCharacterPage(
  universeId = 'primary',
  offset = 0,
  limit = 24,
  revision?: number,
): Promise<CharacterPage> {
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error('Invalid character page');
  return customFetch<CharacterPage>(`/api/universe/characters/page?${new URLSearchParams({
    universeId, offset: String(offset), limit: String(limit),
    ...(revision === undefined ? {} : { revision: String(revision) }),
  })}`, { method: 'GET', responseType: 'json', cache: 'no-store' });
}

/** Read-only feed page, kept separate from full-universe synchronization. */
export interface PostPage {
  posts: SocialState['posts'];
  total: number;
  nextOffset: number | null;
  revision: number;
}
export async function loadPostPage(options: {
  universeId?: string;
  authorId?: string;
  revision?: number;
  offset?: number;
  limit?: number;
} = {}): Promise<PostPage> {
  const { universeId = 'primary', authorId, revision, offset = 0, limit = 20 } = options;
  if (!Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error('Invalid post page');
  const params = new URLSearchParams({ universeId, offset: String(offset), limit: String(limit) });
  if (authorId) params.set('authorId', authorId);
  if (revision !== undefined) params.set('revision', String(revision));
  return customFetch<PostPage>(`/api/universe/posts/page?${params}`, {
    method: 'GET', responseType: 'json', cache: 'no-store',
  });
}

/** Read-only conversation history page, scoped to the authenticated owner's universe. */
export interface MessagePage {
  messages: SocialState['messages'];
  total: number;
  nextOffset: number | null;
  revision: number;
}
export async function loadMessagePage(options: {
  threadId: string;
  universeId?: string;
  revision?: number;
  offset?: number;
  limit?: number;
}): Promise<MessagePage> {
  const { threadId, universeId = 'primary', revision, offset = 0, limit = 30 } = options;
  if (!threadId || !Number.isSafeInteger(offset) || offset < 0 ||
      !Number.isSafeInteger(limit) || limit < 1 || limit > 50)
    throw new Error('Invalid message page');
  const params = new URLSearchParams({ threadId, universeId, offset: String(offset), limit: String(limit) });
  if (revision !== undefined) params.set('revision', String(revision));
  return customFetch<MessagePage>(`/api/universe/messages/page?${params}`, {
    method: 'GET', responseType: 'json', cache: 'no-store',
  });
}

/** Fetch just the server revision, without transferring the entire social state. */
export async function loadUniverseRevision(universeId = 'primary'): Promise<number> {
  const result = await customFetch<{ revision: number }>(`/api/universe/revision?${new URLSearchParams({ universeId })}`, {
    method: 'GET', responseType: 'json', cache: 'no-store',
  });
  if (!Number.isSafeInteger(result.revision) || result.revision < 0)
    throw new Error('Invalid universe revision response');
  return result.revision;
}

export async function saveUniverse(state: SocialState, expectedRevision: number, universeId = 'primary'): Promise<UniverseEnvelope> {
  const data: UniverseInput = { state, expectedRevision };
  try {
    return await customFetch<UniverseEnvelope>(`/api/universe?${new URLSearchParams({ universeId })}`, {
      method: 'PUT', responseType: 'json',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(data),
    });
  } catch (error) {
    if (error instanceof ApiError && error.status === 409)
      throw new RevisionConflict('Otro dispositivo guardó cambios. Se volverán a combinar.');
    throw error;
  }
}

// Owner-scoped recovery never overwrites or removes the original legacy copy.
export interface Recovery {
  base: SocialState | null;
  state: SocialState;
}
export async function loadRecovery(owner: string): Promise<Recovery | null> {
  return await tx<Recovery | undefined>('readonly', st => st.get(`recovery:${owner}`)) ?? null;
}
export async function saveRecovery(owner: string, recovery: Recovery): Promise<void> {
  await tx('readwrite', st => st.put(recovery, `recovery:${owner}`));
}
export async function fingerprint(state: SocialState): Promise<string> {
  const bytes = new TextEncoder().encode(JSON.stringify(state));
  const hash = await crypto.subtle.digest('SHA-256', bytes);
  return [...new Uint8Array(hash)].map(b => b.toString(16).padStart(2, '0')).join('');
}
export async function importedBy(owner: string, hash: string): Promise<boolean> {
  return !!await tx('readonly', st => st.get(`import:${owner}:${hash}`));
}
export async function markImported(owner: string, hash: string): Promise<void> {
  await tx('readwrite', st => st.put({ verifiedAt: new Date().toISOString() }, `import:${owner}:${hash}`));
}
export async function legacyOwner(hash: string): Promise<string | null> {
  return await tx<string | undefined>('readonly', st => st.get(`legacy-owner:${hash}`)) ?? null;
}
/** Read + claim in one IDB transaction, so two signed-in tabs cannot claim it. */
export async function claimLegacy(owner: string, hash: string): Promise<void> {
  const db = await openDb();
  try {
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction(STORE, 'readwrite');
      const store = transaction.objectStore(STORE);
      const request = store.get(`legacy-owner:${hash}`);
      request.onsuccess = () => {
        if (request.result && request.result !== owner) transaction.abort();
        else store.put(owner, `legacy-owner:${hash}`);
      };
      transaction.oncomplete = () => resolve();
      transaction.onabort = () => reject(new Error('Estos datos locales ya están vinculados a otro propietario.'));
      transaction.onerror = () => reject(transaction.error);
    });
  } finally { db.close(); }
}
export async function cachedMigration(owner: string, hash: string): Promise<SocialState | null> {
  return await tx<SocialState | undefined>('readonly', st => st.get(`migration:${owner}:${hash}`)) ?? null;
}
export async function cacheMigration(owner: string, hash: string, state: SocialState): Promise<void> {
  await tx('readwrite', st => st.put(state, `migration:${owner}:${hash}`));
}
export async function verifySavedUniverse(expected: SocialState, universeId = 'primary'): Promise<void> {
  const actual = await customFetch<UniverseEnvelope>(`/api/universe/verify?${new URLSearchParams({ universeId })}`, {
    method: 'GET', responseType: 'json', cache: 'no-store',
  });
  if (JSON.stringify(actual.state) !== JSON.stringify(expected)) {
    const canonical = (v: unknown): string => JSON.stringify(v, (_key, value) =>
      value && typeof value === 'object' && !Array.isArray(value)
        ? Object.fromEntries(Object.entries(value).sort(([a], [b]) => a.localeCompare(b)))
        : value);
    if (canonical(actual.state) !== canonical(expected))
      throw new Error('El servidor cambió durante la verificación. La copia local sigue intacta; reintenta la importación.');
  }
}

export async function moveLocalImagesToPrivateStorage(state: SocialState): Promise<SocialState> {
  const { uploadPrivateImage } = await import('@/lib/media');
  const refs = [
    ...state.characters.flatMap((character) => [
      character.avatar,
      ...(character.identity?.referenceImages ?? []),
    ]),
    ...state.posts.flatMap((post) => [post.image, ...(post.media ?? []).map(item => item.url)]),
    ...state.stories.map((story) => story.image),
    ...state.messages.flatMap(message => (message.attachments ?? []).map(item => item.url)),
  ];
  if (refs.some((ref) => ref.startsWith('blob:'))) {
    throw new Error(
      'Hay una foto local antigua que el navegador ya no puede leer. Tus demás datos siguen intactos; vuelve a seleccionar esa foto antes de sincronizar.',
    );
  }

  const localImages = [...new Set(refs.filter((ref) => ref.startsWith('data:')))];
  const uploads = await Promise.all(
    localImages.map(async (ref) => [ref, await uploadPrivateImage(ref)] as const),
  );
  const replacement = new Map(uploads);
  const mapRef = (ref: string) => replacement.get(ref) ?? ref;
  return {
    ...state,
    characters: state.characters.map((character) => ({
      ...character,
      avatar: mapRef(character.avatar),
      identity: {
        ...(character.identity ?? {}),
        provider: character.identity?.provider ?? 'mock',
        seed: character.identity?.seed ?? 0,
        appearance: character.identity?.appearance ?? '',
        styleNotes: character.identity?.styleNotes ?? '',
        updatedAt: character.identity?.updatedAt ?? new Date(0).toISOString(),
        referenceImages: (character.identity?.referenceImages ?? []).map(mapRef),
      },
    })),
    posts: state.posts.map((post) => ({
      ...post, image: mapRef(post.image),
      ...(post.media ? { media: post.media.map(item => ({ ...item, url: mapRef(item.url) })) } : {}),
    })),
    stories: state.stories.map((story) => ({ ...story, image: mapRef(story.image) })),
    messages: state.messages.map(message => ({ ...message,
      ...(message.attachments ? { attachments: message.attachments.map(item => ({ ...item, url: mapRef(item.url) })) } : {}) })),
  };
}

