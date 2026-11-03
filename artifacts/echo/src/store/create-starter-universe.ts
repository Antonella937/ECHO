import type { Character, SocialState } from '../domain/types';
import { createSeedState } from './seed';

export type CreatorPlan = 'free' | 'creator';

export interface StarterUniverseInput {
  plan: CreatorPlan;
  universeName: string;
  displayName: string;
  username: string;
  bio: string;
}

/**
 * Build a genuinely empty, owner-scoped starter universe for first-time users.
 * The stable "nela" id is retained because older sync fallbacks expect it; the
 * visible identity is entirely supplied by the new owner.
 */
export function createStarterUniverse(input: StarterUniverseInput, completedAt = new Date().toISOString()): SocialState {
  const seed = createSeedState();
  const template = seed.characters.find(character => character.id === 'nela');
  if (!template) throw new Error('No se pudo crear el perfil inicial.');

  const firstCharacter: Character = {
    ...template,
    handle: input.username.trim().replace(/^@/, '').toLowerCase(),
    name: input.displayName.trim(),
    occupation: '',
    bio: input.bio.trim(),
    location: '',
    avatar: 'asset:account-default',
    accountType: 'personal',
    verified: false,
    archived: false,
    providerRef: { provider: 'mock', externalId: null, status: 'not_connected', lastSyncAt: null },
    identity: {
      provider: 'mock',
      referenceImages: [],
      seed: 0,
      appearance: '',
      styleNotes: '',
      updatedAt: completedAt,
    },
  };

  return {
    ...seed,
    currentCharacterId: firstCharacter.id,
    characters: [firstCharacter],
    follows: { [firstCharacter.id]: [] },
    posts: [],
    comments: [],
    stories: [],
    messages: [],
    notifications: [],
    highlights: [],
    // New commercial universes start with their own first character, not demo accounts.
    accountCatalogVersion: 1,
    creatorSetup: {
      plan: input.plan,
      universeName: input.universeName.trim(),
      completedAt,
    },
  };
}
