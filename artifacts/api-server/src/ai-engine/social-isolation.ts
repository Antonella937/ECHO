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
