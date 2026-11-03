# Social content read access (current backend scope)

This document records the read surfaces that actually exist. It does not imply
that private-character protection is a complete social product.

## Existing read surfaces

- `GET /universe` and `/universe/verify` are owner-scoped. They return the
  authenticated owner's universe only; they are not cross-owner social routes.
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

There are currently no cross-owner read routes for profile JSON, feed lists,
post details, Story lists/details, comments, or social counts. No such route was
added for this step. Those resources are therefore not available cross-owner
through the API; the media gate does not substitute for those missing routes.
When those routes are introduced, each must call the same character-level
authorization policy before returning content, lists, counts, or metadata.
There is no UI caller for the private-media viewer query contract in this step.

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

The cross-owner authorization path is exercised by synthetic HTTP tests. It
does not establish that a real Clerk browser session or a frontend caller has
been validated. DM attachment reads are not part of this media policy and
remain owner-scoped.
