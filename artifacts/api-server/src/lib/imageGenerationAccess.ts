/**
 * Image generation account eligibility. Private beta remains the default.
 * Public mode must be explicitly enabled only after launch legal and billing
 * checks; authentication, photo credits and the global budget are separate gates.
 */
export function imageGenerationAccessMode(env: NodeJS.ProcessEnv = process.env): 'authenticated_users' | 'explicit_allowlist' {
  return env.ECHO_IMAGE_GENERATION_ACCESS_MODE === 'authenticated_users' &&
    env.ECHO_PUBLIC_IMAGE_GENERATION_APPROVED === 'true'
    ? 'authenticated_users' : 'explicit_allowlist';
}

export function canGenerateImages(ownerId: string | undefined, configuredIds = process.env.ECHO_IMAGE_GENERATION_ALLOWED_USER_IDS): boolean {
  if (!ownerId) return false;
  if (imageGenerationAccessMode() === 'authenticated_users') return true;
  if (!configuredIds?.trim()) return false;
  return configuredIds.split(',').map(value => value.trim()).filter(Boolean).includes(ownerId);
}

export function imageGenerationAccessStatus(ownerId: string | undefined) {
  return { allowed: canGenerateImages(ownerId), accessMode: imageGenerationAccessMode() };
}
