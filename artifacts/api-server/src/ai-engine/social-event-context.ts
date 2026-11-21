/**
 * Social feed is universe-wide. The Kindroid group is selected by the actor,
 * never by the author of the post/comment. This lets characters in different
 * technical groups interact with the same ECHO post.
 */
export interface SocialFeedEvent {
  situation: 'comment' | 'like_post' | 'like_comment';
  actorId: string;
  post: { id: string; authorId: string; caption?: string | null };
  parentComment?: { id: string; authorId: string; text: string } | null;
}

export function socialEventContext(event: SocialFeedEvent): string {
  if (!event.actorId || !event.post.id || !event.post.authorId) {
    throw new Error('SOCIAL_EVENT_CONTEXT_INVALID');
  }
  if (event.situation === 'like_comment' && !event.parentComment) {
    throw new Error('SOCIAL_COMMENT_REQUIRED');
  }
  return [
    `ECHO feed event: ${event.situation}`,
    `Actor ECHO character: ${event.actorId}`,
    `Post ID: ${event.post.id}`,
    `Post author ECHO character: ${event.post.authorId}`,
    `Visible caption: ${(event.post.caption ?? '[no caption]').slice(0, 500)}`,
    event.parentComment
      ? `Visible comment ID: ${event.parentComment.id}; by ${event.parentComment.authorId}: ${event.parentComment.text.slice(0, 300)}`
      : '',
    'Respond only as the actor. Do not speak for the post author or other characters.',
  ].filter(Boolean).join('\n');
}
