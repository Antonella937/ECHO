import type { SocialState } from '@/domain/types';
import type { UniverseInput } from '@workspace/api-client-react';
import { uploadPrivateImage } from '@/lib/media';

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

export async function clearLegacyState(): Promise<void> {
  try {
    await tx('readwrite', (st) => st.delete(KEY));
  } catch {
    /* ignore */
  }
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(BACKEND_KEY);
}

export async function loadUniverse(): Promise<SocialState | null> {
  const response = await fetch('/api/universe', { credentials: 'same-origin' });
  if (!response.ok) throw new Error(await responseError(response, 'No se pudo cargar tu universo.'));
  return ((await response.json()) as { state: SocialState | null }).state;
}

export async function saveUniverse(state: SocialState): Promise<SocialState> {
  const data: UniverseInput = { state };
  const response = await fetch('/api/universe', {
    method: 'PUT',
    credentials: 'same-origin',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify(data),
  });
  if (!response.ok) throw new Error(await responseError(response, 'No se pudo guardar tu universo.'));
  return ((await response.json()) as { state: SocialState }).state;
}

export async function moveLocalImagesToPrivateStorage(state: SocialState): Promise<SocialState> {
  const refs = [
    ...state.characters.flatMap((character) => [
      character.avatar,
      ...character.identity.referenceImages,
    ]),
    ...state.posts.map((post) => post.image),
    ...state.stories.map((story) => story.image),
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
        ...character.identity,
        referenceImages: character.identity.referenceImages.map(mapRef),
      },
    })),
    posts: state.posts.map((post) => ({ ...post, image: mapRef(post.image) })),
    stories: state.stories.map((story) => ({ ...story, image: mapRef(story.image) })),
  };
}

async function responseError(response: Response, fallback: string): Promise<string> {
  try {
    const payload = (await response.json()) as { error?: string };
    return payload.error || fallback;
  } catch {
    return fallback;
  }
}
