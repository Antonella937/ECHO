---
name: Character privacy scope
description: The product distinction between storing a character visibility preference and enforcing access to social content.
---

Per-character `public`/`private` visibility is only a persisted owner setting until profile, feed, post, and Story read paths enforce it. Do not present a private setting as protecting content before those server-side read checks exist.

**Why:** the user explicitly scoped the initial privacy step to persistence and owner-only changes, while deferring social read enforcement and requiring that it not be described as complete privacy.

**How to apply:** in ECHO privacy work, keep this limitation visible in status reports and beta readiness decisions until the relevant read APIs enforce the setting.

Cross-owner social reads must authorize a full target identity (owner + universe + character), derive the viewer owner only from the Clerk session, and return allowlisted profile/content projections rather than serialized character or social state.

**Why:** IDs repeat across owners and universes, and full state includes private configuration, interaction details, and counts that should not leak through public profile/feed surfaces.

**How to apply:** require a viewer character scoped to the authenticated owner for private-follow access; filter inaccessible content before pagination and omit internal configuration, messages, reactions, and counts from cross-owner read responses.

Until cross-owner mutation APIs exist, posts from other owners must remain read-only in the client; posts in the owner's active universe retain their existing interactions.

**Why:** local social actions resolve only character/post IDs, which can collide across owners and universes.

**How to apply:** keep full owner + universe + character + post identity for remote feed entries; never pass remote IDs into local-only mutation handlers or invent omitted counts.
