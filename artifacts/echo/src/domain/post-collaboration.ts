import type { Post } from './types';

/** Collaboration is opt-in: inviting an account never makes it a co-author. */
export function inviteCollaborators(post: Post, inviteeIds: string[]): Post {
  const invited = [...new Set([...(post.collaborationInvites ?? []), ...inviteeIds])]
    .filter(id => id !== post.authorId && !(post.collaboratorIds ?? []).includes(id))
    .slice(0, 10);
  return { ...post, collaborationInvites: invited };
}

export function respondToCollaboration(post: Post, actorId: string, accept: boolean): Post {
  if (!(post.collaborationInvites ?? []).includes(actorId)) return post;
  return {
    ...post,
    collaborationInvites: (post.collaborationInvites ?? []).filter(id => id !== actorId),
    collaboratorIds: accept
      ? [...new Set([...(post.collaboratorIds ?? []), actorId])]
      : (post.collaboratorIds ?? []),
  };
}

export function visibleProfilePosts(posts: Post[], profileId: string): Post[] {
  return posts.filter(post => post.authorId === profileId || post.collaboratorIds?.includes(profileId));
}
