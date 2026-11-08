/**
 * Fail-closed story forwarding policy. This is intentionally pure so the API
 * can apply it after loading authoritative, owner-scoped relationship data.
 * Do not authorize forwarding from client-provided follow/block maps.
 */
export type StorySharePolicyInput = {
  senderId: string;
  authorId: string;
  recipientId: string;
  storyActive: boolean;
  authorVisibility: "public" | "private";
  recipientCanViewStory: boolean;
  /** Accepted directed edges, not pending follow requests. */
  acceptedFollows: ReadonlyArray<{ followerId: string; followedId: string }>;
  /** Directed blocks, including blocks initiated by either participant. */
  blocks: ReadonlyArray<{ blockerId: string; blockedId: string }>;
  /** Must be true only after loading the complete authoritative block graph. */
  blocksVerified: boolean;
};

export function canForwardStory(input: StorySharePolicyInput): boolean {
  const { senderId, authorId, recipientId, storyActive, authorVisibility,
    recipientCanViewStory, acceptedFollows, blocks } = input;
  if (!input.blocksVerified || !senderId || !authorId || !recipientId || senderId === recipientId ||
      !storyActive || !recipientCanViewStory) return false;
  if (authorVisibility !== "public" && authorVisibility !== "private") return false;
  const participants = [senderId, authorId, recipientId];
  if (blocks.some(({ blockerId, blockedId }) =>
    participants.includes(blockerId) && participants.includes(blockedId) && blockerId !== blockedId)) return false;
  const follows = (a: string, b: string) =>
    a === b || acceptedFollows.some(e => e.followerId === a && e.followedId === b);
  // Both the sender and the original author must have an accepted mutual
  // relationship with the recipient, even when the author's profile is public.
  return follows(senderId, recipientId) && follows(recipientId, senderId) &&
    follows(authorId, recipientId) && follows(recipientId, authorId);
}

/** Fail-closed legacy close-friends visibility check for autonomy decisions. */
export function canCharacterViewCloseFriendsStory(stateValue: unknown, storyValue: unknown, viewerId: string): boolean {
  if (!stateValue || typeof stateValue !== "object" || !storyValue || typeof storyValue !== "object") return false;
  const state = stateValue as Record<string, unknown>;
  const story = storyValue as Record<string, unknown>;
  if (story.closeFriendsOnly !== true) return true;
  const closeFriends = state.closeFriends && typeof state.closeFriends === "object"
    ? state.closeFriends as Record<string, unknown> : {};
  const list = Array.isArray(closeFriends[String(story.authorId)]) ? closeFriends[String(story.authorId)] as unknown[] : [];
  const allowed = Array.isArray(story.allowedViewerIds) ? story.allowedViewerIds : list;
  return list.includes(viewerId) && allowed.includes(viewerId);
}
