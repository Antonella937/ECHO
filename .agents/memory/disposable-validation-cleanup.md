---
name: Disposable validation cleanup
description: Complete owner-scoped cleanup must be verified after test sessions are stopped, not inferred from universe deletion.
---

Stop disposable browser writers and revoke/delete the disposable Clerk account before final owner-scoped database cleanup. Verify all dependent table groups, including relationships where the disposable owner is either endpoint.

**Why:** A browser validation initially reported cleanup complete, but a broader follow-up still found a universe, character-privacy and entitlement rows. Universe-only checks are insufficient; active client synchronization also makes cleanup ordering important.

**How to apply:** After isolated authenticated tests, verify zero residual universe, entitlement, privacy, usage, media, Vision, autonomy and relationship rows for that exact disposable owner. Never broaden deletion predicates to real users, and never persist authentication redirect query strings in reports.
