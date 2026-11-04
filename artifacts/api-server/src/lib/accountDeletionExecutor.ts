import { planOwnedMediaDeletion, type OwnedMediaRecord } from "./accountDeletionPlan";

export type DeletionAdapters = {
  removeMedia: (path: string) => Promise<void>;
  removeDatabaseOwner: (ownerId: string) => Promise<void>;
  removeIdentity: (ownerId: string) => Promise<void>;
};

/**
 * Isolated deletion orchestrator. No production route calls this.
 * The caller must supply isolated adapters, verified owner-scoped records,
 * and a separate authorization mechanism before any real-world integration.
 * Stop immediately on failure, never report completion after partial deletion.
 */
export async function executeIsolatedDeletion(
  ownerId: string,
  records: readonly OwnedMediaRecord[],
  adapters: DeletionAdapters,
): Promise<{ status: "COMPLETED"; mediaDeleted: number }> {
  const plan = planOwnedMediaDeletion(ownerId, records);
  for (const path of plan.objectPaths) await adapters.removeMedia(path);
  await adapters.removeDatabaseOwner(plan.ownerId);
  await adapters.removeIdentity(plan.ownerId);
  return { status: "COMPLETED", mediaDeleted: plan.objectPaths.length };
}
