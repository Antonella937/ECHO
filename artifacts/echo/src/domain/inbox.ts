import { threadIdFor, type Character, type Message, type SocialState } from './types';

export interface ThreadSummary {
  other: Character;
  last: Message;
  unread: number;
}
/** Existing persisted seed/migrated messages ARE history, not empty contacts. */
export function hasMessageContent(message: Message): boolean {
  return Boolean(message.text.trim() || message.postId || message.storyId || message.attachments?.length);
}
export function selectInbox(state: SocialState, characterId: string): ThreadSummary[] {
  const grouped = new Map<string, Message[]>();
  for (const message of state.messages) {
    if (!hasMessageContent(message)) continue;
    const other = message.senderId === characterId ? message.recipientId :
      message.recipientId === characterId ? message.senderId : null;
    if (!other || other === characterId || message.threadId !== threadIdFor(characterId, other)) continue;
    const messages = grouped.get(other) ?? [];
    messages.push(message); grouped.set(other, messages);
  }
  return state.characters.flatMap(other => {
    const messages = grouped.get(other.id);
    if (!messages?.length) return [];
    const last = messages.reduce((a, b) => a.createdAt >= b.createdAt ? a : b);
    return [{ other, last, unread: messages.filter(m => m.recipientId === characterId && !m.readBy.includes(characterId)).length }];
  }).sort((a, b) => b.last.createdAt.localeCompare(a.last.createdAt));
}
