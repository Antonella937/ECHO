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
