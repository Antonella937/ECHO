import type { SocialState } from '@workspace/api-zod';

/** Owner-private account rules, independent of whichever character is active. */
export function universeAccountError(state: SocialState): string | null {
  for (const post of state.posts) {
    if (!post.media) continue;
    if (!post.media.length || post.media.length > 10) return 'Un carrete debe contener entre 1 y 10 fotos o videos.';
    if (post.media.some(item => !['image', 'video'].includes(item.type))) return 'Formato de publicación inválido.';
    if (new Set(post.media.map(item => item.id)).size !== post.media.length)
      return 'Los elementos de un carrete deben tener identificadores únicos.';
    if (post.media.some(item => !item.id.trim() || !item.url.trim())) return 'Falta un identificador o una foto del carrete.';
    if (post.image !== post.media[0].url) return 'La portada debe coincidir con la primera foto del carrete.';
  }
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
  for (const accountId of ids) {
    if (state.posts.filter(p => p.authorId === accountId && p.pinned).length > 3) return 'Solo se pueden fijar 3 publicaciones por perfil.';
  }
  if (state.posts.some(p => p.taggedAccountIds?.some(id => !ids.has(id))) ||
    state.stories.some(s => s.mentionedAccountIds?.some(id => !ids.has(id)))) return 'Una etiqueta referencia una cuenta inexistente.';
  const comments = new Map(state.comments.map(c => [c.id, c]));
  for (const comment of state.comments) {
    const visited = new Set([comment.id]);
    let parent = comment.parentId;
    while (parent) {
      const target = comments.get(parent);
      if (!target || target.postId !== comment.postId || visited.has(parent)) return 'El hilo de comentarios contiene referencias inválidas.';
      visited.add(parent); parent = target.parentId;
    }
  }
  for (const message of state.messages) {
    if (message.hiddenForIds?.some(id => ![message.senderId, message.recipientId].includes(id)))
      return 'Solo los participantes pueden ocultar un mensaje para sí mismos.';
    if (message.quoteMessageId && !state.messages.some(m => m.id === message.quoteMessageId && m.threadId === message.threadId))
      return 'Una cita debe pertenecer a la misma conversación.';
    if (message.reactions?.some(r => ![message.senderId, message.recipientId].includes(r.actorId)) ||
      new Set(message.reactions?.map(r => r.actorId)).size !== (message.reactions?.length ?? 0)) return 'Reacción de mensaje inválida.';
  }
  for (const story of state.stories) {
    if (story.reactions?.some(r => !ids.has(r.actorId)) ||
      new Set(story.reactions?.map(r => r.actorId)).size !== (story.reactions?.length ?? 0)) return 'Reacción de historia inválida.';
  }
  if (new Set(state.highlights?.map(h => h.id)).size !== (state.highlights?.length ?? 0) ||
    state.highlights?.some(h => !ids.has(h.authorId) || h.storyIds.some(id => !state.stories.some(s => s.id === id && s.authorId === h.authorId))))
    return 'La destacada debe contener historias de su propia cuenta.';
  const validTarget = (id: string, self: string) => id === 'owner' || (ids.has(id) && id !== self);
  for (const account of state.characters) {
    const config = account.configuration;
    if (!config) continue; // Compatible with original profiles without rewriting them.
    try { new Intl.DateTimeFormat('es', { timeZone: config.routine.timezone }); } catch { return 'Zona horaria inválida.'; }
    if (config.relationships.some(r => !validTarget(r.targetId, account.id)) ||
        new Set(config.relationships.map(r => r.targetId)).size !== config.relationships.length)
      return 'Una relación apunta a una cuenta inexistente, a sí misma o está duplicada.';
    if (config.currentState.companions.some(id => !validTarget(id, account.id))) return 'Compañía inválida.';
    if ([...config.memory.permanent, ...config.memory.relationships, ...config.memory.recent].some(m => m.targetId && !validTarget(m.targetId, account.id)) ||
        config.memory.relationships.some(m => !m.targetId)) return 'Un recuerdo apunta a un vínculo inválido.';
    for (const entry of config.routine.entries) {
      if (!entry.title.trim() || (entry.recurrence === 'weekly' && !entry.weekdays.length)) return 'Actividad sin nombre o días.';
      if (entry.recurrence === 'once' && (!entry.date || Number.isNaN(Date.parse(`${entry.date}T00:00:00Z`)) ||
          new Date(`${entry.date}T00:00:00Z`).toISOString().slice(0, 10) !== entry.date)) return 'Fecha puntual inválida.';
    }
    if (config.social.minReplyMinutes != null && config.social.maxReplyMinutes != null &&
        config.social.minReplyMinutes > config.social.maxReplyMinutes) return 'La demora mínima supera a la máxima.';
    if (config.memory.recent.length > config.memory.recentLimit) return 'La memoria reciente supera el límite configurado.';
    for (const items of [config.relationships, config.routine.entries, config.memory.permanent, config.memory.relationships, config.memory.recent]) {
      if (new Set(items.map(item => item.id)).size !== items.length) return 'Identificadores duplicados en la ficha.';
    }
  }
  return null;
}
