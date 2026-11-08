/** Independent controls for social activity, user-directed DMs, and character-to-character DMs. */
export interface CharacterCommunicationPermissions {
  socialAutonomy: boolean;
  autonomousDmToUser: boolean;
  characterToCharacterDm: boolean;
  /** A blocked pair overrides the general character-to-character permission. */
  blockedPeerIds: string[];
  /** Explicit allowlist: no character-to-character DM without a per-peer Yes. */
  allowedPeerIds?: string[];
}
export type CommunicationKind = 'social' | 'dm_to_user' | 'character_dm';
export interface CommunicationRequest {
  kind: CommunicationKind;
  senderId: string;
  recipientId?: string | null;
  senderPermissions: CharacterCommunicationPermissions;
  recipientPermissions?: CharacterCommunicationPermissions | null;
}
export function mayCommunicate(input: CommunicationRequest): boolean {
  if (input.kind === 'social') return input.senderPermissions.socialAutonomy;
  if (input.kind === 'dm_to_user') return input.senderPermissions.autonomousDmToUser;
  if (!input.senderPermissions.characterToCharacterDm || !input.recipientPermissions?.characterToCharacterDm) return false;
  if (!input.recipientId || input.senderId === input.recipientId) return false;
  if (!input.senderPermissions.allowedPeerIds?.includes(input.recipientId)) return false;
  if (!input.recipientPermissions.allowedPeerIds?.includes(input.senderId)) return false;
  if (input.senderPermissions.blockedPeerIds.includes(input.recipientId)) return false;
  if (input.recipientPermissions.blockedPeerIds.includes(input.senderId)) return false;
  return true;
}
export type RelationshipBoundary = 'platonic' | 'romantic_allowed' | 'unspecified';
/** Never infer permission to flirt from the ability to exchange private messages. */
export function mayInitiateFlirtation(
  senderBoundary: RelationshipBoundary,
  recipientBoundary: RelationshipBoundary,
  establishedCommitmentConflict: boolean,
): boolean {
  return senderBoundary === 'romantic_allowed' &&
    recipientBoundary === 'romantic_allowed' &&
    !establishedCommitmentConflict;
}
