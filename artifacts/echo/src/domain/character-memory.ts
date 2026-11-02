import { characterConfig } from './character-core';
import type { SocialEvent } from './events';
import type { SocialState } from './types';

/** Bounded contextual index of real events, not a second unbounded transcript. */
export function rememberActivity(before: SocialState, after: SocialState, event: SocialEvent): SocialState {
  if (before === after) return after;
  let participants: string[] = [], text = '', kind: 'post' | 'conversation' | 'interaction' = 'interaction';
  switch (event.type) {
    case 'post.created': participants = [event.post.authorId]; text = `Publicó: ${event.post.caption}`; kind = 'post'; break;
    case 'story.created': participants = [event.story.authorId]; text = `Compartió una historia: ${event.story.caption}`; kind = 'post'; break;
    case 'comment.created': {
      const post = after.posts.find(p => p.id === event.comment.postId);
      participants = [event.comment.authorId, ...(post ? [post.authorId] : [])];
      text = `Comentario: ${event.comment.text}`; break;
    }
    case 'message.sent':
      participants = [event.message.senderId, event.message.recipientId];
      text = `Mensaje de ${after.characters.find(c => c.id === event.message.senderId)?.name ?? 'una cuenta'}: ${event.message.text || (event.message.postId ? 'publicación compartida' : 'historia compartida')}`;
      kind = 'conversation'; break;
    default: return after;
  }
  return { ...after, characters: after.characters.map(character => {
    if (!participants.includes(character.id)) return character;
    const configuration = characterConfig(character);
    const id = `recent_${event.eventId}_${character.id}`;
    if (configuration.memory.recent.some(m => m.id === id)) return character;
    configuration.memory.recent.push({
      id, text: text.slice(0, 500), targetId: participants.find(p => p !== character.id) ?? null,
      createdAt: event.at, updatedAt: event.at, kind, sourceId: event.eventId, promotedTo: null,
    });
    configuration.memory.recent = configuration.memory.recent.sort((a, b) => a.createdAt.localeCompare(b.createdAt) || a.id.localeCompare(b.id)).slice(-configuration.memory.recentLimit);
    // This timestamp is an observed real interaction; location/mood are never invented.
    configuration.currentState.lastActivityAt = event.at;
    return { ...character, configuration };
  }) };
}
