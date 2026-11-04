---
name: Disposable validation cleanup
description: Complete owner-scoped cleanup must be verified after test sessions are stopped, not inferred from universe deletion.
---

Stop disposable browser writers and revoke/delete the disposable Clerk account before final owner-scoped database cleanup. Verify all dependent table groups, including relationships where the disposable owner is either endpoint.

**Why:** A browser validation initially reported cleanup complete, but a broader follow-up still found a universe, character-privacy and entitlement rows. Universe-only checks are insufficient; active client synchronization also makes cleanup ordering important.

**How to apply:** After isolated authenticated tests, verify zero residual universe, entitlement, privacy, usage, media, Vision, autonomy and relationship rows for that exact disposable owner. Never broaden deletion predicates to real users, and never persist authentication redirect query strings in reports.

Recover abandoned fixtures only with positive ownership evidence: matching Clerk development markers, expected synthetic content, the private file's ACL/known seed fingerprint, and no references outside the verified fixture scope. Compare counts and table fingerprints outside that scope before and after cleanup. A clean Git tree is not evidence that external resources were removed.

**Why:** Interrupted browser work can leave accounts, files and universes behind. A previous teardown removed universes but omitted entitlement rows created indirectly, introducing snapshot differences that content counts alone did not detect.

**How to apply:** Stop if ownership is ambiguous. Attribute any newly leaked test rows to exact owners and the current execution window; do not sweep older rows by prefix. Confirm account deletion, physical file absence, credential-file removal and all owner-scoped groups before retiring the temporary runner.

Clerk development sign-in tickets are single-use. After a testing-browser context is lost, issue a fresh ticket for the positively identified disposable owner instead of reusing its private manifest's consumed ticket.

**Why:** A browser context expired during validation; the replacement browser correctly rejected the already-consumed ticket. That was a test-session recovery problem, not an application authentication defect.

**How to apply:** Keep ticket values out of logs/reports, replace them only in the private temporary manifest, and continue the same disposable-owner validation without changing normal authentication.
