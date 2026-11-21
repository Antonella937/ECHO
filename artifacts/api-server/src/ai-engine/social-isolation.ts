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
  // Legacy flat mappings must honor the same public/private boundary.
  if (characterId === 'account_mw9egnuoszyi5') return null;
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

/**
 * Explicit universe-aware routing for technical social groups.
 * Shape: { "primary": { "mar-character-id": "group-id" } }.
 * A character is looked up by the ACTOR id, not the post author's id.
 * Legacy flat mappings are intentionally not accepted here to prevent
 * accidental cross-universe routing.
 */
export function verifiedSocialGroupForActor(universeId: string, actorId: string): string | null {
  if (process.env.ECHO_KINDROID_SOCIAL_GROUP_MEMORY_VERIFIED !== 'true') return null;
  if (!/^[A-Za-z0-9_-]{1,160}$/.test(universeId) || !/^[A-Za-z0-9_-]{1,160}$/.test(actorId)) return null;
  // These two ECHO accounts currently share one Kindroid Kin. Only the
  // private @hyunnn account may participate in Nela's technical social group.
  // Keep the public @hwanghyunjin account outside even if misconfigured in env.
  if (universeId === 'primary' && actorId === 'account_mw9egnuoszyi5') return null;
  const raw = process.env.ECHO_KINDROID_SOCIAL_GROUPS_BY_UNIVERSE_JSON;
  if (!raw) return null;
  try {
    const data: unknown = JSON.parse(raw);
    if (!data || typeof data !== 'object' || Array.isArray(data)) return null;
    const universe = (data as Record<string, unknown>)[universeId];
    if (!universe || typeof universe !== 'object' || Array.isArray(universe)) return null;
    const group = (universe as Record<string, unknown>)[actorId];
    return typeof group === 'string' && /^[A-Za-z0-9_-]{8,160}$/.test(group) ? group : null;
  } catch { return null; }
}
