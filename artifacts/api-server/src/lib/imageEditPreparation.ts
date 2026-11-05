import type { ImageGenerationReference } from './imageGenerationPayload';

/** Offline edit plan: source image first, followed by up to three identity references. */
export function prepareImageEdit(input: {
  instruction: string;
  sourcePath: string;
  identityPaths: string[];
}) {
  const instruction = input.instruction.trim();
  if (instruction.length < 3 || instruction.length > 2000) throw Error('INVALID_IMAGE_EDIT_INSTRUCTION');
  if (!/^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(input.sourcePath)) throw Error('INVALID_IMAGE_EDIT_SOURCE');
  const identityPaths = [...new Set(input.identityPaths)].filter(path => path !== input.sourcePath).slice(0, 3);
  const referencePaths = [input.sourcePath, ...identityPaths];
  const prompt = [
    'Edit the FIRST supplied image. It is the source image to modify, not merely an identity reference.',
    'Preserve the same person, face, recognizable features and all details not explicitly requested to change.',
    'Use any additional reference images only to maintain character identity.',
    'Requested edit: ' + instruction,
  ].join('\n');
  return { prompt, referencePaths };
}

/** Ensures the image edit's source occupies the first provider reference slot. */
export function validateImageEditReferences(
  sourcePath: string,
  loaded: Array<ImageGenerationReference & { path: string }>,
) {
  if (!loaded.length || loaded[0].path !== sourcePath || loaded.length > 4) throw Error('IMAGE_EDIT_SOURCE_MISSING');
  return loaded;
}
