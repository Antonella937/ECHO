import { createStarterUniverse, type StarterUniverseInput } from '../store/create-starter-universe';

/** A full document load discards the previous universe's store and query cache. */
export async function activateOwnedUniverse(input: {
  ownerId: string;
  universeId: string;
  allowedIds: readonly string[];
  isCurrentOwner: () => boolean;
  flush: () => Promise<void>;
  select: (ownerId: string, universeId: string) => void;
  reload: () => void;
}) {
  if (!input.isCurrentOwner() || !input.allowedIds.includes(input.universeId)) {
    throw new Error('Ese universo no está disponible en tu sesión.');
  }
  await input.flush();
  if (!input.isCurrentOwner()) throw new Error('La sesión cambió. Vuelve a abrir el selector.');
  input.select(input.ownerId, input.universeId);
  input.reload();
}

export function newUniverseInput(input: StarterUniverseInput) {
  const name = input.universeName.trim();
  const displayName = input.displayName.trim();
  const username = input.username.trim().replace(/^@/, '').toLowerCase();
  if (!name || name.length > 60) throw new Error('El nombre del universo debe tener entre 1 y 60 caracteres.');
  if (!displayName || displayName.length > 80) throw new Error('Completa el nombre del primer personaje.');
  if (!/^[a-z0-9_][a-z0-9_.]{0,29}$/.test(username)) throw new Error('El usuario debe tener entre 1 y 30 letras, números, puntos o guiones bajos.');
  return {
    name,
    state: createStarterUniverse({ ...input, universeName: name, displayName, username }),
  };
}
