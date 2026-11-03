---
name: Universe lifecycle safety
description: Intentional safeguards and retention boundaries for editing, archiving and deleting user universes.
---

Archive is reversible and preserves content; an archived universe still consumes structural capacity. Keep at least one unarchived universe available per owner.

**Why:** Archiving must not become a way to bypass capacity limits or leave a user without an accessible workspace.

Permanent deletion intentionally retains a content-free technical marker. Never remove that marker as routine cleanup for an existing owner.

**Why:** An offline/stale client can otherwise interpret a missing universe as new and recreate previously deleted content. Disposable test owners may be fully purged after their sessions/accounts are stopped.

Owner-wide usage/accounting and uploads are separate from universe content deletion. Do not blindly delete uploaded bytes when deleting a universe.

**Why:** Uploaded files can be referenced by other universes, and deleting a universe must not reset the owner's monthly consumption. Any later file cleanup must check remaining references, including archived universes.
