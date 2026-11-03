import type { SocialState } from '../domain/types';

export type MediaSource = {
  sourceUniverseId: string;
  sourceCharacterId: string;
  sourceType: 'avatar' | 'post' | 'story' | 'message';
  sourceContentId: string;
};
export type MediaScope = { universeId: string; state: SocialState };
export type MediaHint = Pick<MediaSource, 'sourceType' | 'sourceContentId'> &
  Partial<Pick<MediaSource, 'sourceCharacterId'>>;

/** Only local protected references receive context; never send identities to third parties. */
export function objectPathForMedia(ref: string): string | null {
  const path = ref.split(/[?#]/, 1)[0];
  if (path.startsWith('/objects/')) return path;
  if (path.startsWith('/api/storage/objects/')) return path.slice('/api/storage'.length);
  return null;
}

/** Resolve actual associations from the currently loaded universe, never a global ID lookup. */
export function mediaSourceFor(scope: MediaScope | null, ref: string, hint?: MediaHint): MediaSource | undefined {
  const path = objectPathForMedia(ref);
  if (!scope || !path) return undefined;
  const matches = (value: string | undefined) => value !== undefined && objectPathForMedia(value) === path;
  const make = (sourceType: MediaSource['sourceType'], sourceCharacterId: string, sourceContentId: string): MediaSource =>
    ({ sourceUniverseId: scope.universeId, sourceCharacterId, sourceType, sourceContentId });
  const eligible = (type: MediaSource['sourceType'], id: string, character: string) => !hint ||
    (hint.sourceType === type && hint.sourceContentId === id &&
      (!hint.sourceCharacterId || hint.sourceCharacterId === character));
  const { state } = scope;
  const avatar = state.characters.find(character => eligible('avatar', character.id, character.id) && matches(character.avatar));
  if (avatar) return make('avatar', avatar.id, avatar.id);
  const post = state.posts.find(post => eligible('post', post.id, post.authorId) &&
    (matches(post.image) || post.media?.some(item => matches(item.url))));
  if (post) return make('post', post.authorId, post.id);
  const story = state.stories.find(story => eligible('story', story.id, story.authorId) && matches(story.image));
  if (story) return make('story', story.authorId, story.id);
  const message = state.messages.find(message => eligible('message', message.id, message.senderId) &&
    message.attachments?.some(item => matches(item.url)));
  if (message) return make('message', message.senderId, message.id);
  // New uploads/drafts are not persisted associations. Keep the existing owner-only
  // fallback; the server still refuses any ambiguous archived reference.
  return undefined;
}

export function privateMediaUrl(ref: string, source?: MediaSource): string {
  if (!objectPathForMedia(ref)) return ref;
  const url = new URL(ref.startsWith('/objects/') ? `/api/storage${ref}` : ref, 'https://local.invalid');
  if (source) for (const [key, value] of Object.entries(source)) url.searchParams.set(key, value);
  return `${url.pathname}${url.search}${url.hash}`;
}
