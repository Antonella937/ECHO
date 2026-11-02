import type { SocialEvent } from './events';
import type { Character, CharacterProviderRef, IdentityReference, MediaRef, SocialState } from './types';

/**
 * Extension contracts for future integrations (e.g. Kindroid Kin API, an image model).
 * Nothing here performs network calls in this prototype.
 */

export interface ActivityContext {
  /** Read-only snapshot of the social graph the character can perceive. */
  state: SocialState;
  character: Character;
  /** Upper bound of events the provider may propose in one call. */
  maxEvents: number;
}

export interface CharacterProvider {
  readonly id: string;
  readonly label: string;
  /** True only when a real engine is connected. */
  readonly live: boolean;
  /** Bind an ECHO character to an external identity (e.g. Kindroid Kin ID). */
  connect(character: Character, externalId: string): Promise<CharacterProviderRef>;
  /**
   * Ask the engine what the character wants to do next. Must return typed
   * SocialEvents (source: 'provider') — posts, stories, likes, comments, DMs.
   */
  proposeActivity(ctx: ActivityContext): Promise<SocialEvent[]>;
}

export interface ImageGenerationRequest {
  characterId: string;
  prompt: string;
  identity: IdentityReference;
  aspect: '4:5' | '9:16' | '1:1';
}

export interface GeneratedImage {
  image: MediaRef;
  provider: string;
  seed: number;
  prompt: string;
}

export interface ImageGenerationProvider {
  readonly id: string;
  readonly label: string;
  readonly live: boolean;
  generate(req: ImageGenerationRequest): Promise<GeneratedImage>;
}

/** Sink through which provider activity enters the store. */
export interface ActivityAdapter {
  ingest(events: SocialEvent[]): void;
}

export class MockCharacterProvider implements CharacterProvider {
  readonly id = 'mock';
  readonly label = 'Simulado (sin motor de IA conectado)';
  readonly live = false;

  async connect(_character: Character, externalId: string): Promise<CharacterProviderRef> {
    return { provider: 'mock', externalId, status: 'not_connected', lastSyncAt: null };
  }

  /** Mock never invents live activity — the seeded history is the only "AI" content. */
  async proposeActivity(_ctx: ActivityContext): Promise<SocialEvent[]> {
    return [];
  }
}

export class MockImageGenerationProvider implements ImageGenerationProvider {
  readonly id = 'mock';
  readonly label = 'Simulado (fotos ilustrativas incluidas)';
  readonly live = false;

  /** Returns the first stored identity reference instead of generating. */
  async generate(req: ImageGenerationRequest): Promise<GeneratedImage> {
    return {
      image: req.identity.referenceImages[0] ?? '',
      provider: this.id,
      seed: req.identity.seed,
      prompt: `${req.identity.appearance}. ${req.identity.styleNotes}. ${req.prompt}`,
    };
  }
}

export const characterProvider: CharacterProvider = new MockCharacterProvider();
export const imageProvider: ImageGenerationProvider = new MockImageGenerationProvider();

/** Run one provider pass for every character and forward events through the adapter seam. */
export async function runProviderPass(state: SocialState, adapter: ActivityAdapter, maxEvents = 3) {
  const all: SocialEvent[] = [];
  for (const character of state.characters) {
    const events = await characterProvider.proposeActivity({ state, character, maxEvents });
    all.push(...events.filter((e) => e.source === 'provider'));
  }
  if (all.length) adapter.ingest(all);
  return all.length;
}
