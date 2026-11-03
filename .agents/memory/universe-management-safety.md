---
name: Universe lifecycle safety
description: Intentional safeguards and retention boundaries for editing, archiving and deleting user universes.
---

Archive is reversible and preserves content; an archived universe still consumes structural capacity. Keep at least one unarchived universe available per owner.

**Why:** Archiving must not become a way to bypass capacity limits or leave a user without an accessible workspace.

Permanent deletion intentionally retains a content-free technical marker. Never remove that marker as routine cleanup for an existing owner.

**Why:** An offline/stale client can otherwise interpret a missing universe as new and recreate previously deleted content. Disposable test owners may be fully purged after their sessions/accounts are stopped.

Archiving denies social content and protected media reads even for the owner; only owner-only management metadata remains available for restoration. Restoration recovers the previous content and consent/privacy settings.

**Why:** "Unavailable until restored" must be consistent across internal loading, direct URLs, accepted relationships and media, not only the selector.

An owner media URL lacking source context is intentionally denied if the object is also referenced by an archived universe. A valid explicit association with an active universe may still be read.

**Why:** Removing query parameters must not bypass archive enforcement. If a legacy shared-image caller breaks, add exact source context rather than restoring an unconditional owner bypass.

Owner-wide usage/accounting and uploads are separate from universe content deletion. Do not blindly delete uploaded bytes when deleting a universe.

**Why:** Uploaded files can be referenced by other universes, and deleting a universe must not reset the owner's monthly consumption. Any later file cleanup must check remaining references, including archived universes.
