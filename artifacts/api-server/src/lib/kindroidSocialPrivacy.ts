import { canCharacterViewCloseFriendsStory } from "./storySharePolicy";
import type { SocialState, Story } from "@workspace/api-zod";

/** Re-evaluate current audience even when an old view receipt exists. */
export function visibleSeenStoriesForKindroid(state: SocialState, actorId: string): Story[] {
  return state.stories.filter(story =>
    story.authorId !== actorId &&
    story.seenBy.includes(actorId) &&
    canCharacterViewCloseFriendsStory(state, story, actorId)
  );
}

/** Conversation archive entries may only cross to the exact DM correspondent. */
export function kindroidMemoryAllowed(memory: {kind?: string;targetId?: string|null}, recipientId: string): boolean {
  return memory.kind !== "conversation" || memory.targetId === recipientId;
}
