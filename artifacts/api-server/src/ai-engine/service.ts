import { PreviewCharacterDecisionBody, SaveUniverseBody, type CharacterDecisionInput } from '@workspace/api-zod';
import { EngineError, type TextProvider } from './contracts';
import { previewDecision } from './engine';

/** Owner must come from verified server authentication, never from request JSON. */
export async function previewForOwner(ownerId: string, input: CharacterDecisionInput, dependencies: {
  read: (ownerId: string) => Promise<{ state: unknown; revision: number }>;
  provider: TextProvider;
}) {
  if (!ownerId) throw new EngineError('AUTHENTICATION_REQUIRED', 401);
  if (!PreviewCharacterDecisionBody.strict().safeParse(input).success) throw new EngineError('INVALID_PREVIEW_INPUT');
  const snapshot = await dependencies.read(ownerId);
  if (!snapshot.state) throw new EngineError('UNIVERSE_NOT_FOUND', 404);
  const parsed = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!parsed.success) throw new EngineError('INVALID_STORED_UNIVERSE', 422);
  return previewDecision(dependencies.provider, parsed.data.state, input, snapshot.revision, new Date(), 'persisted_owner_universe');
}
