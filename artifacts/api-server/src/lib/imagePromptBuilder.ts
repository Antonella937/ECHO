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
