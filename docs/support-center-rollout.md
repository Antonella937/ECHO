# ECHO support center — rollout checklist

Status: **draft / not deployed**. Do not merge until all checks pass.

## Configuration
1. Back up the intended staging PostgreSQL database and review Drizzle's proposed SQL.
2. Apply the `echo_support_tickets` schema to staging with the existing Drizzle workflow; confirm it exists before enabling API routes.
3. Set `ECHO_ADMIN_USER_IDS` on the staging Render API to the exact authorized Clerk `user_...` ID(s). Do not store IDs in client code.
4. Verify `ECHO_ALLOWED_ORIGINS` and existing beta allowlist settings remain unchanged.
5. Run workspace typecheck and builds, then smoke test with two separate Clerk accounts and one admin.

## Privacy/security checks
- Unauthenticated: support endpoints return 401.
- Account A sees only A's tickets, never B's.
- Non-admin: admin list/update returns 403.
- Admin: list and update work; invalid status is rejected.
- Invalid input: empty description, overlong fields and unsupported category return 400.
- Support requests work without alpha draft acknowledgement.
- Failed database requests show an error, never a fake success.
- No attachments, cookies, bearer tokens or conversation content are auto-collected.
- The admin panel must never display stale cached tickets after an authorization error.

## Deployment order
1. Database migration, then API deployment, then frontend deployment.
2. Submit a test report; confirm ID, status, own history and admin view.
3. Test a second user and authorization boundaries.
4. Confirm rollback plan and retention policy before opening beyond private beta.

## Known limitations
- No screenshot upload, email notifications, rate limiting, ticket retention/deletion policy or audit trail yet.
- Admin access is enforced server-side via `ECHO_ADMIN_USER_IDS`; client route visibility alone is not authorization.
- No CI or end-to-end tests have been executed in this branch yet.
