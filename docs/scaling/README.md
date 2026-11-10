# ECHO scalability rollout (multi-tenant, large universes)

## Current status

- **Production source of truth:** `echo_universes.state` JSON and revision-based compare-and-swap. Do not delete or rewrite it during initial migration.
- **Implemented transitional API:** read-only paginated characters, posts and messages endpoints. These currently deserialize the full universe on the server and are **not yet used by UI**.
- **Client:** typed request helpers exist, but full-state sync still powers the screens.
- **Proposed SQL only:** `01-partitioned-social-data.sql` and `02-fair-autonomy-queue.sql` have **not been deployed**.
- No validated production capacity or load test results. Targeting thousands of users requires measurement and appropriate paid infrastructure.

## Non-negotiable invariants

1. Every query and job is scoped to authenticated `owner_id` and `universe_id`. Never trust either owner ID from request body.
2. No loss of posts, relationships, character memories, media references or chat history. Export/backup and verify before backfill.
3. Preserve the current revision/concurrency semantics during cutover. A second device must not silently overwrite data.
4. Character-level privacy, follow requests, blocking and visibility must be enforced in new endpoints, not only in the UI.
5. Autonomy work must be idempotent and bounded by per-owner and global budgets. No one user may monopolize workers.
6. Founders' membership exceptions are not exemptions from resource safety ceilings.

## Release stages

### A — Migration groundwork

- Introduce versioned, reviewed Drizzle migrations for partitioned tables and indexes; check existing schema for collisions.
- Add an idempotent, resumable backfill with a per-universe checkpoint of source revision and row counts.
- Write parity checks: per owner/universe compare counts and stable IDs for profiles/posts/messages, plus checksums of canonical payloads.
- Add dual-read (legacy fallback), behind a server feature flag. Never switch writes before parity and conflict checks pass.

### B — Independent storage and pagination

- Implement cursor-based DB queries for profiles, posts and messages; offset-based JSON projections are transitional only.
- Separate writes by entity with version checks, transactions, and an explicit ordering strategy.
- Migrate UI views to paged queries with bounded cache, infinite scroll, request cancellation and appropriate invalidation.
- Avoid downloading or cloning the full universe on ordinary page navigation. Keep local recovery only for dirty edits.

### C — Autonomy isolation

- Deploy durable queue schema with migration and worker service, initially disabled.
- Implement fair scheduling, per-owner concurrency, global concurrency, backpressure, retries, lease expiry and dead-letter diagnostics.
- Enforce rate/cost budgets at dispatch and at execution; require idempotency and permission revalidation.
- Observe queue age, worker errors, provider latency, token usage, per-owner load and API response time.

### D — Release readiness (before inviting testers)

- Unit/integration tests for authentication, cross-tenant isolation, pagination boundaries, migration parity, retry safety and multi-device sync.
- Backup/restore drill; rollback switches; monitoring and alerts for errors and queue lag.
- Test a single-user universe with hundreds of profiles and many posts/messages on mobile.
- Gradual rollout: internal owner -> tester -> invited beta. Do not automatically run schema SQL in production.

### E — Invite-only beta

- Invite 20–50 people initially, but do not set a platform cap of 50. Observe real multiuser concurrency and scale service capacity as measurements require.
- Maintain feature flags to pause autonomous generation without taking down reading/messaging.

## Important

This document describes a migration plan, not a completed scalable implementation. SQL files are proposals until migrated through the actual database migration framework and verified.
