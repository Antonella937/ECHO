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

Open forms need their own original-value snapshot in addition to universe revision checks. Apply only intentionally edited fields; reject incompatible changes since the form opened.

**Why:** Background synchronization can advance the universe's merge base while an editor still contains old values. Saving the entire old form would then look like a valid new edit and silently undo another device's work.

**How to apply:** Use this rule for account fields, audience figures and future editing forms. Keep independent remote edits even if the user leaves their corresponding form inputs untouched.

Universe switching deliberately finishes synchronization before changing the owner-scoped selection, then loads a fresh document instead of reusing the previous universe's in-memory store.

**Why:** A partial client-side switch can leave old characters, pending writes or query results associated with the new selection. Failed synchronization must leave the current universe selected.

**How to apply:** Preserve this boundary when extending the universe selector; do not optimize away the reload without equivalent store/cache teardown and pending-write guarantees.
