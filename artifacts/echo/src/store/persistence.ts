import type { SocialState } from '@/domain/types';

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

export type StorageBackend = 'indexeddb' | 'localstorage';
let backend: StorageBackend = 'indexeddb';
export const getBackend = () => backend;

export async function loadState(): Promise<SocialState | null> {
  // A failed IndexedDB write may leave an older snapshot behind. Once a
  // fallback write succeeds, that localStorage snapshot is authoritative.
  if (localStorage.getItem(BACKEND_KEY) === 'localstorage') {
    const raw = localStorage.getItem(LS_KEY);
    if (raw) {
      backend = 'localstorage';
      return JSON.parse(raw) as SocialState;
    }
  }
  try {
    const s = await tx<SocialState | undefined>('readonly', (st) => st.get(KEY));
    return s ?? null;
  } catch {
    backend = 'localstorage';
    const raw = localStorage.getItem(LS_KEY);
    return raw ? (JSON.parse(raw) as SocialState) : null;
  }
}

export async function saveState(state: SocialState): Promise<void> {
  if (backend === 'indexeddb') {
    try {
      await tx('readwrite', (st) => st.put(state, KEY));
      return;
    } catch {
      backend = 'localstorage';
    }
  }
  try {
    localStorage.setItem(LS_KEY, JSON.stringify(state));
    localStorage.setItem(BACKEND_KEY, 'localstorage');
  } catch {
    throw new Error('No queda espacio en este dispositivo. Los últimos cambios no se han guardado.');
  }
}

export async function clearState(): Promise<void> {
  try {
    await tx('readwrite', (st) => st.delete(KEY));
  } catch {
    /* ignore */
  }
  localStorage.removeItem(LS_KEY);
  localStorage.removeItem(BACKEND_KEY);
}

export async function estimateUsage(): Promise<string | null> {
  try {
    const est = await navigator.storage?.estimate?.();
    if (!est?.usage) return null;
    return `${(est.usage / (1024 * 1024)).toFixed(1)} MB`;
  } catch {
    return null;
  }
}
