/**
 * Pure, side-effect-free account deletion planning.
 * This module MUST NOT delete provider objects or database rows.
 * The eventual executor must recheck ownership against the database,
 * verify each provider deletion, and handle partial failures durably.
 */
export type OwnedMediaRecord = { ownerId: string; objectPath: string };

export class AccountDeletionPlanError extends Error {
  constructor(message: string) { super(message); this.name = "AccountDeletionPlanError"; }
}

const validPrivatePath = /^\/objects\/uploads\/[0-9a-f-]{36}$/i;

/** Refuse mixed-owner input rather than risk deleting somebody else's files. */
export function planOwnedMediaDeletion(ownerId: string, media: readonly OwnedMediaRecord[]) {
  if (!/^user_[A-Za-z0-9]+$/.test(ownerId)) throw new AccountDeletionPlanError("INVALID_OWNER_ID");
  const paths = new Set<string>();
  for (const record of media) {
    if (record.ownerId !== ownerId) throw new AccountDeletionPlanError("CROSS_OWNER_MEDIA");
    if (!validPrivatePath.test(record.objectPath)) throw new AccountDeletionPlanError("INVALID_MEDIA_PATH");
    paths.add(record.objectPath);
  }
  return Object.freeze({ ownerId, objectPaths: Object.freeze([...paths].sort()) });
}
