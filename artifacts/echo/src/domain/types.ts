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
  /** Specific facial features for image-reference prompting. */
  facialDescription?: string;
  /** Body shape, tattoos, hair and other physical characteristics. */
  bodyDescription?: string;
  styleNotes: string;
  updatedAt: ISODate;
}

/** A single AI person can own multiple independent social accounts. 
 * Existing characters without personId are their own person (backwards compatible).
 * Account-specific posts, follows, privacy and handles remain keyed by Character.id.
 */
export type PersonId = string;

export function personIdFor(character: Pick<Character, 'id' | 'personId'>): PersonId {
  return character.personId || character.id;
}

export function accountsForPerson(characters: Character[], account: Character): Character[] {
  const personId = personIdFor(account);
  return characters.filter((candidate) => personIdFor(candidate) === personId);
}

export interface Character {
  /** Shared AI identity key across personal, professional or alternate accounts.
   * For a legacy single-account character, defaults to id.
   * Set this to the original character's personId/id when adding another account.
   */
  personId?: PersonId;
  /** Optional presentation/context guidance for this particular account, not a second persona. */
  accountContext?: string;
  configuration?: import('@workspace/api-client-react').CharacterConfiguration;
  id: CharacterId;
  handle: string;
  name: string;
  occupation: string;
  bio: string;
  location: string;
  avatar: MediaRef;
  providerRef: CharacterProviderRef;
  identity: IdentityReference;
  communityCommentsEnabled?: boolean;
  accountType?: 'personal' | 'artist' | 'band' | 'business' | 'venue' | 'organization';
  verified?: boolean;
  archived?: boolean;
  privateAccount?: boolean;
  accountIdentity?: { description: string; voice: string; facts: string };
  professionalCategory?: string;
  contactEmail?: string;
  website?: string;
  /** Fictional base audience; actual relationships remain in follows. */
  displayMetrics?: { followers?: number | null; following?: number | null };
}

export type PostMedia = import('@workspace/api-client-react').PostMedia;

export interface MusicClip { trackId: string; title: string; startSeconds: number; clipSeconds: 15 | 30; }

export interface Post {
  poll?: { question: string; options: Array<{ id: string; text: string }>; votes: Record<string, string>; closesAt?: ISODate };
  /** Collaboration invitations are not co-authorship until accepted. */
  collaborationInvites?: string[];
  collaboratorIds?: string[];
  musicClip?: MusicClip;
  taggedAccountIds?: string[];
  commentsEnabled?: boolean;
  pinned?: boolean;
  pinOrder?: number;
  editedAt?: ISODate;
  id: string;
  authorId: CharacterId;
  image: MediaRef;
  /** Optional ordered carousel. image stays the first item for legacy cover consumers. */
  media?: PostMedia[];
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
  /** Simulated community handle; never impersonates an ECHO account. */
  guestHandle?: string;
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
  musicClip?: MusicClip;
  closeFriendsOnly?: boolean;
  allowedViewerIds?: string[];
  displayMetrics?: { views?: number | null };
  mentionedAccountIds?: string[];
  reactions?: SocialReaction[];
  /** Story likes are separate from emoji reactions and never send a DM. */
  likes?: CharacterId[];
  music?: import('@workspace/api-client-react').StoryMusic;
  id: string;
  authorId: CharacterId;
  image: MediaRef;
  caption: string;
  createdAt: ISODate;
  seenBy: CharacterId[];
  origin: ContentOrigin;
}

export interface Message {
  musicTrackId?: string;
  musicTitle?: string;
  editedAt?: ISODate;
  savedByIds?: string[];
  /** Per-character visibility only. Never removes the other participant's copy. */
  hiddenForIds?: string[];
  quoteMessageId?: string;
  attachments?: MessageAttachment[];
  reactions?: SocialReaction[];
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
  | 'story_like'
  | 'follow'
  | 'collaboration_invite'
  | 'collaboration_accepted';

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

export type ImageStyle = 'natural' | 'phone' | 'analog' | 'editorial' | 'cinematic';

export interface SocialState {
  /** Default photographic style for manual and future autonomous AI images. */
  imageStyle?: ImageStyle;
  appearance?: Appearance;
  highlights?: StoryHighlight[];
  closeFriends?: Record<CharacterId, CharacterId[]>;
  /** Beta product selection saved with a newly-created private universe. */
  creatorSetup?: import('@workspace/api-client-react').CreatorSetup;
  version: number;
  currentCharacterId: CharacterId;
  /** Human-operated account to prioritize for autonomous interactions, independent of active identity. */
  primaryCharacterId?: CharacterId;
  characters: Character[];
  /** follower -> followed ids */
  follows: Record<CharacterId, CharacterId[]>;
  followRequests?: Record<CharacterId, CharacterId[]>;
  posts: Post[];
  comments: Comment[];
  stories: Story[];
  messages: Message[];
  notifications: Notification[];
  accountCatalogVersion?: number;
}

export const SCHEMA_VERSION = 1;
export type Appearance = import('@workspace/api-client-react').Appearance;
export type SocialReaction = import('@workspace/api-client-react').SocialReaction;
export type MessageAttachment = import('@workspace/api-client-react').MessageAttachment;
export type StoryHighlight = import('@workspace/api-client-react').StoryHighlight;

export function threadIdFor(a: CharacterId, b: CharacterId): string {
  return [a, b].sort().join('__');
}
