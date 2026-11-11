/**
 * Read-only Kindroid profile import preparation.
 * No Kindroid API writes, no memory/conversation imports, no implicit account matching.
 * Consumers MUST show a review and obtain confirmation before persisting anything.
 */
export type KindroidProfileImport = {
  kindroid_id?: string;
  name: string;
  original_profile: {
    backstory?: string;
    response_directive?: string;
    example_message?: string;
    appearance_description?: string;
  };
};

export type ProfileImportBundle = {
  format: 'echo_kindroid_profile_import_v1';
  characters: KindroidProfileImport[];
};

export type ProfileImportPreview = {
  sourceName: string;
  kindroidId?: string;
  proposed: {
    backstory: string;
    responseDirective: string;
    exampleMessage: string;
    appearanceDescription: string;
  };
  requiresBackstoryReview: true;
  /** Account assignment must be explicit, never guessed by display name. */
  echoCharacterId: null;
};

const safeString = (value: unknown, limit: number) =>
  typeof value === 'string' ? value.slice(0, limit).trim() : '';

export function prepareKindroidProfileImport(raw: unknown): ProfileImportPreview[] {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) throw new Error('INVALID_IMPORT_FILE');
  const bundle = raw as Partial<ProfileImportBundle>;
  if (bundle.format !== 'echo_kindroid_profile_import_v1' || !Array.isArray(bundle.characters)) {
    throw new Error('UNSUPPORTED_IMPORT_FORMAT');
  }
  if (bundle.characters.length > 200) throw new Error('IMPORT_TOO_LARGE');
  return bundle.characters.map((item) => {
    if (!item || typeof item !== 'object' || !item.original_profile || typeof item.original_profile !== 'object') {
      throw new Error('INVALID_CHARACTER_PROFILE');
    }
    const name = safeString(item.name, 200);
    if (!name) throw new Error('MISSING_CHARACTER_NAME');
    return {
      sourceName: name,
      kindroidId: safeString(item.kindroid_id, 200) || undefined,
      proposed: {
        backstory: safeString(item.original_profile.backstory, 24000),
        responseDirective: safeString(item.original_profile.response_directive, 8000),
        exampleMessage: safeString(item.original_profile.example_message, 8000),
        appearanceDescription: safeString(item.original_profile.appearance_description, 8000),
      },
      requiresBackstoryReview: true,
      echoCharacterId: null,
    };
  });
}

/** Strict allowlist: social settings, memories, relationships and chat history are never mapped. */
export const KINDROID_IMPORT_ALLOWED_FIELDS = [
  'backstory', 'responseDirective', 'exampleMessage', 'appearanceDescription',
] as const;
