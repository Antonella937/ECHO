import { createHash } from 'node:crypto';

/**
 * Stable identity for a single ECHO social opportunity.
 * The executor must persist this key under a UNIQUE constraint before
 * publishing; generating a key alone does not prevent duplicates.
 */
export interface SocialActionIdentity {
  ownerId: string;
  universeId: string;
  actorId: string;
  situation: 'post' | 'comment' | 'like_post' | 'like_comment' | 'story_reaction';
  eventId: string;
  targetId: string;
}

export function socialActionIdempotencyKey(identity: SocialActionIdentity): string {
  const fields = [
    identity.ownerId, identity.universeId, identity.actorId,
    identity.situation, identity.eventId, identity.targetId,
  ];
  if (fields.some(value => !value || !value.trim() || value.length > 256)) {
    throw new Error('SOCIAL_ACTION_IDENTITY_INVALID');
  }
  // JSON array framing avoids ambiguous concatenation (e.g. a|bc vs ab|c).
  return createHash('sha256').update(JSON.stringify(fields)).digest('hex');
}
