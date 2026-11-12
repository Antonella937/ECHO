import { and, eq, or, sql } from "drizzle-orm";
import type { AnyPgColumn } from "drizzle-orm/pg-core";
import {
  db, echoUniversesTable, echoCreatorEntitlementsTable,
  echoAutonomyCharactersTable, echoAutonomyRunsTable,
  echoVisionAnalysesTable, echoVisionMediaRefsTable, echoVisionPostSummariesTable,
  echoCharacterPrivacyTable, echoCharacterFollowsTable, echoCharacterFollowRequestsTable,
} from "@workspace/db";
import type { UniverseManagementInput } from "@workspace/api-zod";

export class UniverseManagementError extends Error {
  constructor(readonly status: number, message: string) { super(message); }
}

/** Serializes with universe saves/creates. No external files or owner-wide usage are deleted. */
export async function manageUniverse(ownerId: string, universeId: string, input: UniverseManagementInput) {
  return db.transaction(async tx => {
    const [entitlement] = await tx.select().from(echoCreatorEntitlementsTable).where(eq(echoCreatorEntitlementsTable.ownerId, ownerId)).for("update");
    const rows = await tx.select().from(echoUniversesTable).where(eq(echoUniversesTable.ownerId, ownerId)).for("update");
    const row = rows.find(item => item.universeId === universeId && !item.deletedAt);
    if (!row) throw new UniverseManagementError(404, "UNIVERSE_NOT_FOUND");
    if (row.revision !== input.expectedRevision) throw new UniverseManagementError(409, "UNIVERSE_REVISION_CONFLICT");
    const setup = row.state.creatorSetup as Record<string, unknown> | undefined;
    const name = typeof setup?.universeName === "string" ? setup.universeName : "Mi universo";
    const fallback = rows.find(item => item.universeId !== universeId && !item.archivedAt && !item.deletedAt);
    if ((input.action === "archive" || input.action === "delete") && !row.archivedAt && !fallback)
      throw new UniverseManagementError(409, "LAST_AVAILABLE_UNIVERSE");
    if (input.action === "delete" && input.confirmationText !== `ELIMINAR ${name}`)
      throw new UniverseManagementError(400, "UNIVERSE_CONFIRMATION_REQUIRED");
    if (input.action === "edit" && (!input.name?.trim() || input.name.trim().length > 60))
      throw new UniverseManagementError(400, "INVALID_UNIVERSE_NAME");

    const scope = (table: { ownerId: AnyPgColumn; universeId: AnyPgColumn }) =>
      and(eq(table.ownerId, ownerId), eq(table.universeId, universeId));
    // Explicit scoped cleanup: most auxiliary tables do not have cascading FKs.
    if (input.action === "delete") {
      await tx.delete(echoVisionMediaRefsTable).where(scope(echoVisionMediaRefsTable));
      await tx.delete(echoVisionPostSummariesTable).where(scope(echoVisionPostSummariesTable));
      await tx.delete(echoVisionAnalysesTable).where(scope(echoVisionAnalysesTable));
      await tx.delete(echoAutonomyRunsTable).where(scope(echoAutonomyRunsTable));
      await tx.delete(echoAutonomyCharactersTable).where(scope(echoAutonomyCharactersTable));
      await tx.delete(echoCharacterPrivacyTable).where(scope(echoCharacterPrivacyTable));
      for (const table of [echoCharacterFollowsTable, echoCharacterFollowRequestsTable]) {
        await tx.delete(table).where(or(
          and(eq(table.sourceOwnerId, ownerId), eq(table.sourceUniverseId, universeId)),
          and(eq(table.targetOwnerId, ownerId), eq(table.targetUniverseId, universeId)),
        ));
      }
    }
    const archivedAt = input.action === "archive" ? row.archivedAt ?? new Date()
      : input.action === "restore" ? null : row.archivedAt;
    await tx.update(echoUniversesTable).set({
      state: input.action === "delete" ? {} : input.action === "edit"
        ? { ...row.state, creatorSetup: {
          ...setup,
          plan: entitlement?.plan ?? (setup?.plan === "creator" ? "creator" : "free"),
          completedAt: typeof setup?.completedAt === "string" ? setup.completedAt : new Date().toISOString(),
          universeName: input.name!.trim(), universeDescription: input.description?.trim() ?? "",
          universeTimeline: input.timeline?.trim() ?? (typeof setup?.universeTimeline === "string" ? setup.universeTimeline : ""),
        } }
        : row.state,
      archivedAt,
      deletedAt: input.action === "delete" ? new Date() : null,
      revision: sql`${echoUniversesTable.revision} + 1`,
      updatedAt: new Date(),
    }).where(scope(echoUniversesTable));
    return {
      revision: row.revision + 1, archived: Boolean(archivedAt),
      deleted: input.action === "delete", fallbackUniverseId: fallback?.universeId ?? null,
    };
  });
}
