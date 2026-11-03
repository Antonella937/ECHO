# Social content read access (current backend scope)

This document records the read surfaces that actually exist. It does not imply
that private-character protection is a complete social product.

## Existing read surfaces

- `GET /universe` and `/universe/verify` are owner-scoped. They return the
  authenticated owner's universe only; they are not cross-owner social routes.
- The authenticated cross-owner social read API now exposes:
  - `GET /social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId`
    for a safe profile projection;
  - `GET /social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/posts`
    for that character's paginated post list;
  - `GET /social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/posts/:postId`
    for a direct post read;
  - `GET /social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/stories`
    for active or highlighted Stories;
  - `GET /social/owners/:targetOwnerId/universes/:targetUniverseId/characters/:targetCharacterId/stories/:storyId`
    for a direct Story read; and
  - `GET /social/feed` for a paginated feed of public posts, the authenticated
    owner's selected universe, and private posts readable by the specified
    viewer character.

  `targetOwnerId` is only a destination locator, never an authorization
  principal. The viewer owner is always `req.userId` from Clerk. Private reads
  require both `viewerUniverseId` and `viewerCharacterId`; the viewer character
  is looked up under that authenticated owner. All responses are private/no-store.
  Profile projections omit configuration, memory, provider references, and
  displayed metrics. Post projections omit comments, likes, saves, social
  counts, and tags. Story projections omit viewers, reactions, mentions, and
  music provider references. Lists return no total count; pagination is capped
  at 50 and uses an identity-scoped cursor.

  The aggregate feed scans the current JSON-backed universe rows, filters each
  author through the existing character privacy/follow policy before paging,
  and does not return unauthorized counts or previews. The authenticated
  owner's own posts are limited to the requested viewer universe; other owners'
  content is included only when public or accepted-follow access is established.
  This full-state scan is a current storage-model constraint and should be
  replaced with indexed social-content storage before large-scale use.
- `GET /storage/objects/*objectPath` is the existing media delivery route.
  It requires authentication, resolves the object to its `echo_media` owner,
  and authorizes it only if the requester owns the upload or the object is
  referenced by a readable character surface (avatar, post, active Story, or
  Story Highlight). Public character media is available to authenticated
  owners. Private character media requires the owner or an accepted follow.
  For a private follower, the request must supply `viewerUniverseId` and
  `viewerCharacterId`; the viewer owner always comes from the authenticated
  session. The response is private/no-store. Unknown and unauthorized objects
  share the same 404 response. Uploads and direct object-store ACLs remain
  private; cross-owner reads go only through the authenticated API proxy.
- Creator account/universe, character-privacy, follow-request, Brain, Vision,
  and Autonomy routes are owner- or participant-scoped. They are not public
  profile/feed/post/Story readers and must not be changed to use social
  follower access.

## Routes that do not exist yet

Cross-owner read routes for comments, likes/reactions, saved-post lists,
notifications, DMs, and social-count endpoints are still absent. They must not
be inferred from the profile/post/feed routes above. No UI callers were added;
the current frontend does not attach the viewer identity to private media URLs,
so accepted-follower media is not yet wired through the existing UI.
The aggregate feed scans JSON state and is suitable only for the current
small/private-beta scale.

## Follow reconciliation

The read adapter unions active rows in `echo_character_follows` with legacy
`SocialState.follows` edges. Its deduplication key contains the complete source
and target identities: owner, universe, and character. Legacy character IDs
are resolvable only inside the containing owner's universe and only when both
characters exist there. It never guesses an external owner or universe from a
matching character ID, performs no migration, and does not rewrite either
source. Only accepted active-follow rows grant private access; pending,
rejected, and cancelled requests do not.

## Limits

The cross-owner authorization paths are exercised by synthetic HTTP tests. They
do not establish that a real Clerk browser session or frontend caller has been
validated. DM attachment reads are not part of this social-content policy and
remain owner-scoped.
