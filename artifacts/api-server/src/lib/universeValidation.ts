import type { SocialState } from '@workspace/api-zod';

/** Owner-private account rules, independent of whichever character is active. */
export function universeAccountError(state: SocialState): string | null {
  const ids = new Set<string>(), handles = new Set<string>();
  for (const account of state.characters) {
    const handle = account.handle.toLowerCase().replace(/^@/, '');
    if (ids.has(account.id)) return 'Hay cuentas con identificadores duplicados.';
    if (handles.has(handle)) return `El @username ${handle} ya está en uso. Cambia el username de la cuenta nueva y reintenta.`;
    if (!/^[a-z0-9_][a-z0-9_.]{0,29}$/.test(handle)) return 'Hay un username inválido.';
    if (!account.name.trim() || account.name.length > 80 || account.bio.length > 500) return 'El nombre o la bio exceden sus límites.';
    ids.add(account.id); handles.add(handle);
  }
  if (!ids.has('nela') || state.characters.find(c => c.id === 'nela')?.archived)
    return 'La identidad principal Nela debe permanecer disponible.';
  if (!state.characters.some(c => c.id === state.currentCharacterId && !c.archived))
    return 'La identidad activa no existe o está archivada.';
  const actors = [...state.posts.map(p => p.authorId), ...state.stories.map(s => s.authorId),
    ...state.comments.map(c => c.authorId), ...state.messages.flatMap(m => [m.senderId, m.recipientId])];
  if (actors.some(id => !ids.has(id))) return 'Falta una cuenta referenciada por el historial. Archiva las cuentas en lugar de eliminarlas.';
  return null;
}
