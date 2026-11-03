---
name: Character privacy scope
description: The product distinction between storing a character visibility preference and enforcing access to social content.
---

Cross-owner access has two independent gates: the target universe must have owner-enabled `sharingEnabled`; then the character's `public`/`private` visibility applies. A public character or accepted follow never overrides a universe with sharing disabled. Same-universe owner access remains available.

**Why:** the user explicitly made each universe private from other creators by default while preserving public/private as a separate character-level rule.

**How to apply:** check universe consent before character visibility on social read routes. Do not describe the system as fully private or beta-safe until every cross-owner surface is covered.

Universe consent applies independently to social reads, follow/request operations and lists, and media delivery. A readable association of a file in another universe must never authorize the requested origin.

**Why:** the user requires isolated universes by default and explicitly prohibited shared-object authorization bypasses.

**How to apply:** authorize the exact owner + universe + character + content association before delivering cross-owner media. Treat each surface's test evidence separately; passing read-route tests does not validate follows or media.

Cross-owner social reads must authorize a full target identity (owner + universe + character), derive the viewer owner only from the Clerk session, and return allowlisted profile/content projections rather than serialized character or social state.

**Why:** IDs repeat across owners and universes, and full state includes private configuration, interaction details, and counts that should not leak through public profile/feed surfaces.

**How to apply:** require a viewer character scoped to the authenticated owner for private-follow access; filter inaccessible content before pagination and omit internal configuration, messages, reactions, and counts from cross-owner read responses.

Until cross-owner mutation APIs exist, posts from other owners must remain read-only in the client; posts in the owner's active universe retain their existing interactions.

**Why:** local social actions resolve only character/post IDs, which can collide across owners and universes.

**How to apply:** keep full owner + universe + character + post identity for remote feed entries; never pass remote IDs into local-only mutation handlers or invent omitted counts.
