---
name: ECHO data preservation
description: User-required guarantees for legacy migration and multi-device editing.
---

Never delete the original local universe as a side effect of importing or resetting the remote account. Mark an import complete only after independently re-reading the stored universe and its referenced private files.

**Why:** The user explicitly required the local copy to remain intact until server and image verification, after discovering the prior import deleted it. Retaining it after verification also leaves a recovery option.

**How to apply:** Keep consent, ownership, verification and import receipts distinct; migration retries must be idempotent. If remote data already exists, combine stable entity identities and explicitly resolve incompatible values instead of ignoring either source.

Concurrent devices must not silently replace each other's recent work. Preserve independent contributions, retain a recovery copy and ask for a decision when edits or deletions conflict.

**Why:** The previous whole-universe save could lose work from a second device; the user required this fixed before further social features.

**How to apply:** Keep atomic server-side stale-write rejection in every save path, including initialization, migration, retries and reset. A local character switch never changes authenticated ownership.
