import { PreviewCharacterDecisionBody, SaveUniverseBody, type CharacterDecisionInput } from '@workspace/api-zod';
import { EngineError, type TextProvider } from './contracts';
import { previewDecision } from './engine';
import type { VisionContext } from '../vision/contracts';

/** Owner must come from verified server authentication, never from request JSON. */
export async function previewForOwner(ownerId: string, input: CharacterDecisionInput, dependencies: {
  read: (ownerId: string, universeId?: string) => Promise<{ state: unknown; revision: number }>;
  provider: TextProvider;
  vision?: (ownerId: string, state: import('@workspace/api-zod').SocialState, input: CharacterDecisionInput) => Promise<VisionContext>;
}) {
  if (!ownerId) throw new EngineError('AUTHENTICATION_REQUIRED', 401);
  if (!PreviewCharacterDecisionBody.strict().safeParse(input).success) throw new EngineError('INVALID_PREVIEW_INPUT');
  const snapshot = await dependencies.read(ownerId, input.universeId ?? 'primary');
  if (!snapshot.state) throw new EngineError('UNIVERSE_NOT_FOUND', 404);
  const parsed = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
  if (!parsed.success) throw new EngineError('INVALID_STORED_UNIVERSE', 422);
  const vision = dependencies.vision
    ? await dependencies.vision(ownerId, parsed.data.state, input)
    : { analyses: {}, postSummaries: {} };
  return previewDecision(dependencies.provider, parsed.data.state, input, snapshot.revision,
    new Date(), 'persisted_owner_universe', vision);
}
