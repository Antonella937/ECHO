/**
 * Group DM domain primitives (phase 1).
 *
 * Group conversations use opaque IDs independent of one-to-one thread IDs.
 * This module intentionally does not mutate the existing DM message format:
 * the shared API schema and persistence must be upgraded together before
 * group messages are enabled in the UI.
 */
export interface GroupConversation {
  id: string;
  name: string;
  avatar: string | null;
  createdBy: string;
  participantIds: string[];
  createdAt: string;
  updatedAt: string;
}

export interface GroupMessage {
  id: string;
  groupId: string;
  senderId: string;
  text: string;
  createdAt: string;
  readBy: string[];
  quoteMessageId?: string;
  attachments?: import('./types').MessageAttachment[];
  reactions?: import('./types').SocialReaction[];
}

export function validateGroupParticipants(creatorId: string, selectedIds: string[]): string[] {
  const ids = [...new Set([creatorId, ...selectedIds].filter(Boolean))];
  if (ids.length < 3) throw new Error('GROUP_REQUIRES_THREE_PARTICIPANTS');
  if (ids.length > 32) throw new Error('GROUP_PARTICIPANT_LIMIT');
  return ids;
}

export function createGroupConversation(input: {
  id: string;
  name: string;
  avatar?: string | null;
  creatorId: string;
  selectedIds: string[];
  now: string;
}): GroupConversation {
  const name = input.name.trim();
  if (!name || name.length > 80) throw new Error('INVALID_GROUP_NAME');
  if (!input.id || !input.id.startsWith('group_')) throw new Error('INVALID_GROUP_ID');
  if (!Number.isFinite(Date.parse(input.now))) throw new Error('INVALID_GROUP_DATE');
  return {
    id: input.id,
    name,
    avatar: input.avatar ?? null,
    createdBy: input.creatorId,
    participantIds: validateGroupParticipants(input.creatorId, input.selectedIds),
    createdAt: input.now,
    updatedAt: input.now,
  };
}

export function canAccessGroup(group: GroupConversation, characterId: string): boolean {
  return group.participantIds.includes(characterId);
}

export function canSendGroupMessage(group: GroupConversation, senderId: string): boolean {
  return canAccessGroup(group, senderId);
}

/** Immutable group operations; membership changes never rewrite historical messages. */
export function renameGroup(group: GroupConversation, actorId: string, name: string, now: string): GroupConversation {
  if (!canAccessGroup(group, actorId)) throw new Error('GROUP_ACCESS_DENIED');
  const nextName = name.trim();
  if (!nextName || nextName.length > 80) throw new Error('INVALID_GROUP_NAME');
  return { ...group, name: nextName, updatedAt: now };
}

export function updateGroupAvatar(group: GroupConversation, actorId: string, avatar: string | null, now: string): GroupConversation {
  if (!canAccessGroup(group, actorId)) throw new Error('GROUP_ACCESS_DENIED');
  return { ...group, avatar, updatedAt: now };
}

export function addGroupParticipants(group: GroupConversation, actorId: string, selectedIds: string[], now: string): GroupConversation {
  if (!canAccessGroup(group, actorId)) throw new Error('GROUP_ACCESS_DENIED');
  const participantIds = [...new Set([...group.participantIds, ...selectedIds.filter(Boolean)])];
  if (participantIds.length > 32) throw new Error('GROUP_PARTICIPANT_LIMIT');
  return { ...group, participantIds, updatedAt: now };
}

export function leaveGroup(group: GroupConversation, actorId: string, now: string): GroupConversation {
  if (!canAccessGroup(group, actorId)) throw new Error('GROUP_ACCESS_DENIED');
  return { ...group, participantIds: group.participantIds.filter(id => id !== actorId), updatedAt: now };
}

export function makeGroupMessage(input: {
  id: string;
  group: GroupConversation;
  senderId: string;
  text: string;
  now: string;
  attachments?: GroupMessage['attachments'];
  quoteMessageId?: string;
}): GroupMessage {
  if (!canSendGroupMessage(input.group, input.senderId)) throw new Error('GROUP_ACCESS_DENIED');
  const text = input.text.trim();
  if (!text && !input.attachments?.length) throw new Error('EMPTY_GROUP_MESSAGE');
  if (text.length > 10000) throw new Error('GROUP_MESSAGE_TOO_LONG');
  return {
    id: input.id, groupId: input.group.id, senderId: input.senderId, text,
    createdAt: input.now, readBy: [input.senderId],
    ...(input.attachments?.length ? { attachments: input.attachments } : {}),
    ...(input.quoteMessageId ? { quoteMessageId: input.quoteMessageId } : {}),
  };
}

export function markGroupMessagesRead(messages: GroupMessage[], group: GroupConversation, actorId: string): GroupMessage[] {
  if (!canAccessGroup(group, actorId)) throw new Error('GROUP_ACCESS_DENIED');
  return messages.map(message => message.groupId === group.id && !message.readBy.includes(actorId)
    ? { ...message, readBy: [...message.readBy, actorId] }
    : message);
}

export function groupUnreadCount(messages: GroupMessage[], group: GroupConversation, actorId: string): number {
  if (!canAccessGroup(group, actorId)) return 0;
  return messages.filter(message => message.groupId === group.id &&
    message.senderId !== actorId && !message.readBy.includes(actorId)).length;
}
