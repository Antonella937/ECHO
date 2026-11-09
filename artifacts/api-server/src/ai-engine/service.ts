import { PreviewCharacterDecisionBody, SaveUniverseBody, type CharacterDecisionInput } from '@workspace/api-zod';
import { EngineError, type TextProvider } from './contracts';
import { previewDecision } from './engine';
import type { VisionContext } from '../vision/contracts';
import { and, desc, eq, inArray, sql } from 'drizzle-orm';
import { parseDmConversationPreferences, type DmConversationPreferences } from './dm-conversation-preferences';
import { db, echoMemoryArchiveTable, echoCharacterGalleryTable } from '@workspace/db';
import { clerkClient } from '@clerk/express';

/** Owner must come from verified server authentication, never from request JSON. */
export async function previewForOwner(ownerId: string, input: CharacterDecisionInput, dependencies: {
  read: (ownerId: string, universeId?: string) => Promise<{ state: unknown; revision: number }>;
  provider: TextProvider;
  vision?: (ownerId: string, state: import('@workspace/api-zod').SocialState, input: CharacterDecisionInput) => Promise<VisionContext>;
  liveDmReply?: boolean;
}) {
  if (!ownerId) throw new EngineError('AUTHENTICATION_REQUIRED', 401);
  if (!PreviewCharacterDecisionBody.strict().safeParse(input).success) throw new EngineError('INVALID_PREVIEW_INPUT');
  const snapshot = await dependencies.read(ownerId, input.universeId ?? 'primary');
  if (!snapshot.state) throw new EngineError('UNIVERSE_NOT_FOUND', 404);
  const parsed = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!parsed.success) throw new EngineError('INVALID_STORED_UNIVERSE', 422);
  const actor = parsed.data.state.characters.find(c => c.id === input.characterId);
  const personId = actor?.personId || actor?.id || input.characterId;
  const linkedAccountIds = parsed.data.state.characters
    .filter(c => (c.personId || c.id) === personId)
    .map(c => c.id);
  const historical = process.env.ECHO_MEMORY_ARCHIVE_ENABLED === 'true'
    ? await db.select({ memoryId: echoMemoryArchiveTable.memoryId, sourceId: echoMemoryArchiveTable.sourceId,
      kind: echoMemoryArchiveTable.kind, targetId: echoMemoryArchiveTable.targetId,
      content: echoMemoryArchiveTable.content, occurredAt: echoMemoryArchiveTable.occurredAt })
      .from(echoMemoryArchiveTable).where(and(
        eq(echoMemoryArchiveTable.ownerId, ownerId),
        eq(echoMemoryArchiveTable.universeId, input.universeId ?? 'primary'),
        inArray(echoMemoryArchiveTable.characterId, linkedAccountIds),
      )).orderBy(desc(echoMemoryArchiveTable.occurredAt)).limit(150)
    : [];
  const vision = dependencies.vision
    ? await dependencies.vision(ownerId, parsed.data.state, input)
    : { analyses: {}, postSummaries: {} };
  let language = 'es';
  try {
    const user = await clerkClient.users.getUser(ownerId);
    const configured = user.privateMetadata?.echoInterfaceLanguage;
    if (typeof configured === 'string' && ['es','en','pt','fr','de','it','ko','ja','zh'].includes(configured)) language = configured;
  } catch { /* Preserve generation availability if account metadata is temporarily unavailable. */ }
  // Supply cached visual observations before the character decides what to say.
  // Never trigger vision billing in the autonomous decision loop.
  const gallery = input.situation === 'post'
    ? await db.select().from(echoCharacterGalleryTable).where(and(
        eq(echoCharacterGalleryTable.ownerId,ownerId),
        eq(echoCharacterGalleryTable.universeId,input.universeId ?? 'primary'),
        eq(echoCharacterGalleryTable.characterId,input.characterId),
        eq(echoCharacterGalleryTable.reserved,false),
      ))
    : [];
  const galleryContext = gallery.filter(photo => (photo.reusable || photo.usedCount === 0) &&
    (!photo.lastUsedAt || photo.usedCount === 0 || Date.now() - photo.lastUsedAt.getTime() >= 30 * 24 * 60 * 60_000))
    .slice(0,20).map(photo => {
      const analysis = photo.visionStatus === 'complete' ? photo.visionAnalysis : null;
      return {
        id: photo.id,
        note: photo.description.slice(0,240),
        scene: typeof analysis?.sceneDescription === 'string' ? analysis.sceneDescription.slice(0,360) : '',
        setting: typeof analysis?.setting === 'string' ? analysis.setting.slice(0,140) : '',
        activities: Array.isArray(analysis?.activities) ? analysis.activities.slice(0,6) : [],
      };
    });
  let dmPreferences: DmConversationPreferences | undefined;
  if (input.situation === 'dm') {
    try {
      const stored = await db.execute(sql`SELECT preferences FROM echo_dm_conversation_preferences
        WHERE owner_id = ${ownerId} AND universe_id = ${input.universeId ?? 'primary'} AND character_id = ${input.characterId} LIMIT 1`);
      if (stored.rows[0]?.preferences) dmPreferences = parseDmConversationPreferences(stored.rows[0].preferences);
    } catch (error) {
      console.warn('DM preference lookup skipped', { reason: error instanceof Error ? error.name : 'UNKNOWN' });
    }
  }
  return previewDecision(dependencies.provider, parsed.data.state, input, snapshot.revision,
    new Date(), 'persisted_owner_universe', vision, historical, dependencies.liveDmReply ? 'live_dm_reply' : 'preview', language, galleryContext, dmPreferences);
}
