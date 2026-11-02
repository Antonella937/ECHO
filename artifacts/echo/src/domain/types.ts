/** ECHO social domain models. All ids are opaque strings. */

export type CharacterId = string;
export type ISODate = string;
/** Media reference: either `asset:<key>` (bundled sample photo) or a data/blob/https URL. */
export type MediaRef = string;

export type ContentOrigin = 'seed' | 'user' | 'provider';

/** Link between an ECHO character and an external character engine (e.g. a Kindroid Kin). */
export interface CharacterProviderRef {
  provider: 'mock' | 'kindroid' | (string & {});
  /** External identifier, e.g. a Kindroid Kin ID. Null while not connected. */
  externalId: string | null;
  status: 'not_connected' | 'connected' | 'error';
  lastSyncAt: ISODate | null;
}

/** Persistent visual identity used by image generation to avoid identity drift. */
export interface IdentityReference {
  provider: 'mock' | (string & {});
  referenceImages: MediaRef[];
  /** Stable seed for providers that support deterministic generation. */
  seed: number;
  /** Physical description and style notes injected into every prompt. */
  appearance: string;
  styleNotes: string;
  updatedAt: ISODate;
}

export interface Character {
  id: CharacterId;
  handle: string;
  name: string;
  occupation: string;
  bio: string;
  location: string;
  avatar: MediaRef;
  providerRef: CharacterProviderRef;
  identity: IdentityReference;
  accountType?: 'personal' | 'band' | 'venue' | 'organization';
  verified?: boolean;
  archived?: boolean;
  /** Fictional base audience; actual relationships remain in follows. */
  displayMetrics?: { followers?: number | null; following?: number | null };
}

export interface Post {
  id: string;
  authorId: CharacterId;
  image: MediaRef;
  caption: string;
  location: string;
  createdAt: ISODate;
  likes: CharacterId[];
  savedBy: CharacterId[];
  origin: ContentOrigin;
  /** True for sample/AI imagery that does not depict real people. */
  illustrative: boolean;
  /** Fictional base counts, never synthetic interaction records. */
  displayMetrics?: { likes?: number | null; comments?: number | null; views?: number | null };
}

export interface Comment {
  id: string;
  postId: string;
  authorId: CharacterId;
  text: string;
  createdAt: ISODate;
  /** Root comment id when this is a reply (threads are one level deep). */
  parentId: string | null;
  /** Author being replied to, if any. */
  replyToAuthorId: CharacterId | null;
  likes: CharacterId[];
  origin: ContentOrigin;
}

export interface Story {
  id: string;
  authorId: CharacterId;
  image: MediaRef;
  caption: string;
  createdAt: ISODate;
  seenBy: CharacterId[];
  origin: ContentOrigin;
}

export interface Message {
  id: string;
  threadId: string;
  senderId: CharacterId;
  recipientId: CharacterId;
  text: string;
  createdAt: ISODate;
  storyId: string | null;
  postId: string | null;
  readBy: CharacterId[];
  origin: ContentOrigin;
}

export type NotificationKind =
  | 'like'
  | 'comment'
  | 'reply'
  | 'comment_like'
  | 'mention'
  | 'message'
  | 'story_reply'
  | 'follow';

export interface Notification {
  id: string;
  recipientId: CharacterId;
  actorId: CharacterId;
  kind: NotificationKind;
  postId: string | null;
  commentId: string | null;
  storyId: string | null;
  excerpt: string;
  createdAt: ISODate;
  read: boolean;
}

export interface SocialState {
  version: number;
  currentCharacterId: CharacterId;
  characters: Character[];
  /** follower -> followed ids */
  follows: Record<CharacterId, CharacterId[]>;
  posts: Post[];
  comments: Comment[];
  stories: Story[];
  messages: Message[];
  notifications: Notification[];
  accountCatalogVersion?: number;
}

export const SCHEMA_VERSION = 1;

export function threadIdFor(a: CharacterId, b: CharacterId): string {
  return [a, b].sort().join('__');
}
