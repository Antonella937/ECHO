/**
 * Founder-world social generation must use Kindroid without touching a Kin's
 * private /v1/send-message history. A separate group is not automatically
 * safe: group context and membership must be provisioned and verified first.
 */
export type FounderSocialSituation = 'post' | 'comment' | 'story_reaction' | 'like_post' | 'like_comment';

const SOCIAL = new Set<string>(['post', 'comment', 'story_reaction', 'like_post', 'like_comment']);

export function requiresIsolatedKindroidSocial(input: {
  live: boolean;
  ownerId: string;
  situation: string;
}): boolean {
  return input.live &&
    input.ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ' &&
    SOCIAL.has(input.situation);
}

/**
 * No supported isolated Kindroid social endpoint is wired yet.
 * Fail closed rather than substitute another model or write social prompts
 * to the private conversation.
 */
export function isolatedKindroidSocialReady(): boolean {
  return false;
}

/**
 * Explicit opt-in per social group. No existing peer/group conversation is
 * automatically eligible: the owner must first confirm memory controls in
 * Kindroid's UI. The external API does not expose those switches.
 */
export function verifiedSocialGroupId(characterId: string): string | null {
  const raw = process.env.ECHO_KINDROID_SOCIAL_GROUP_IDS_JSON;
  const verified = process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED === 'true';
  if (!verified || !raw) return null;
  try {
    const mappings: unknown = JSON.parse(raw);
    if (!mappings || typeof mappings !== 'object' || Array.isArray(mappings)) return null;
    const id = (mappings as Record<string, unknown>)[characterId];
    return typeof id === 'string' && /^[A-Za-z0-9_-]{8,160}$/.test(id) ? id : null;
  } catch {
    return null;
  }
}
