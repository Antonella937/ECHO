/**
 * Private beta access gate. A missing allowlist means nobody can generate.
 * This gate is independent of API-key presence and the global spending ledger.
 */
export function canGenerateImages(ownerId: string | undefined, configuredIds = process.env.ECHO_IMAGE_GENERATION_ALLOWED_USER_IDS): boolean {
  if (!ownerId || !configuredIds?.trim()) return false;
  const ids = configuredIds.split(',').map(value => value.trim()).filter(Boolean);
  return ids.includes(ownerId);
}

export function imageGenerationAccessStatus(ownerId: string | undefined) {
  return {
    allowed: canGenerateImages(ownerId),
    accessMode: 'explicit_allowlist' as const,
  };
}
