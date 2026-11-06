import type { ImageGenerationStyle } from './imageGenerationProvider';

export const imageStyleInstructions: Record<ImageGenerationStyle, string> = {
  natural: 'Natural candid photorealism, realistic skin texture, pores, natural imperfections, believable lighting.',
  phone: 'Photorealistic smartphone snapshot, spontaneous framing, realistic flash or ambient light, subtle digital noise.',
  analog: 'Photorealistic 35mm film photography, fine film grain, organic colors, authentic analog exposure.',
  editorial: 'Photorealistic editorial fashion photography, professional but believable lighting, realistic skin and anatomy.',
  cinematic: 'Photorealistic cinematic still, dramatic naturalistic light, deep shadows, realistic proportions.',
};

export interface ImagePromptIdentity {
  facialDescription?: unknown;
  bodyDescription?: unknown;
  appearance?: unknown;
  styleNotes?: unknown;
}

export function buildCharacterImagePrompt(input: {
  name: string;
  scene: string;
  style: ImageGenerationStyle;
  identity: ImagePromptIdentity;
}) {
  const scene = input.scene.trim();
  if (scene.length < 3 || scene.length > 2000) throw Error('INVALID_IMAGE_SCENE');
  const descriptions = [
    input.identity.facialDescription, input.identity.bodyDescription,
    input.identity.appearance, input.identity.styleNotes,
  ].filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
    .map(v => v.slice(0, 4000));
  return [
    'Create a believable real photograph, not an illustration, doll, render or beauty-filtered image.',
    imageStyleInstructions[input.style],
    'Keep the same character identity, facial proportions, distinctive marks and physical details as the provided references.',
    `Character: ${input.name.slice(0, 160)}.`,
    ...descriptions,
    `Scene: ${scene}.`,
    'Avoid waxy/plastic skin, artificial symmetry, airbrushing and uncanny facial features.',
  ].join('\n');
}

/** Build a single scene with distinct identities; never blend character features. */
export function buildMultiCharacterImagePrompt(input: {
  characters: Array<{ name: string; identity: ImagePromptIdentity }>;
  scene: string;
  style: ImageGenerationStyle;
}): string {
  if (input.characters.length < 1 || input.characters.length > 4) throw Error('INVALID_IMAGE_CHARACTER_COUNT');
  const scene = input.scene.trim();
  if (scene.length < 3 || scene.length > 2000) throw Error('INVALID_IMAGE_SCENE');
  const identities = input.characters.map((character, index) => {
    const details = [
      character.identity.facialDescription, character.identity.bodyDescription,
      character.identity.appearance, character.identity.styleNotes,
    ].filter((value): value is string => typeof value === 'string' && !!value.trim())
      .map(value => value.slice(0, 1500));
    return [
      `Person ${index + 1}: ${character.name.slice(0, 160)}.`,
      ...details,
      `Any reference images assigned to Person ${index + 1} depict ONLY ${character.name.slice(0, 160)}.`,
    ].join('\n');
  });
  return [
    'Create one believable real photograph, not an illustration or render.',
    imageStyleInstructions[input.style],
    `The photograph must contain ${input.characters.length} distinct named people. Preserve each individual identity.`,
    'Do not merge, swap, average, or transfer faces, hairstyles, tattoos, body features or other traits between people.',
    ...identities,
    `Scene: ${scene}.`,
    'Natural anatomy, authentic skin texture and lighting; no beauty-filtered or plastic faces.',
  ].join('\n');
}

/** Resolve whole-name mentions in a scene against characters in this owner universe only. */
export function resolveSceneCharacters<T extends { id: string; name: string; archived?: boolean }>(
  scene: string, active: T, available: T[], maxCharacters = 4,
): T[] {
  const normalize = (value: string) => value.normalize('NFD').replace(/[\u0300-\u036f]/g, '').toLocaleLowerCase();
  const text = normalize(scene);
  const matches = available.filter(character => !character.archived && character.id !== active.id
    && typeof character.name === 'string' && character.name.trim().length >= 2
    && new RegExp(`(^|[^\\p{L}\\p{N}])${normalize(character.name.trim()).replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}(?=$|[^\\p{L}\\p{N}])`, 'u').test(text));
  return [active, ...matches.slice(0, Math.max(0, maxCharacters - 1))];
}
