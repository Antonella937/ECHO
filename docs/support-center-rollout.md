# ECHO support center — rollout checklist

Status: **draft / not deployed**. Do not merge until all checks pass.

## Configuration
1. Back up the intended staging PostgreSQL database and review Drizzle's proposed SQL.
2. Apply the `echo_support_tickets` schema to staging with the existing Drizzle workflow; confirm it exists before enabling API routes.
3. Set `ECHO_ADMIN_USER_IDS` on the staging Render API to the exact authorized Clerk `user_...` ID(s). Do not store IDs in client code.
4. Verify the existing CORS configuration and beta allowlist settings remain unchanged.
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
- GitHub Actions typecheck, build and support policy unit tests passed at commit `3083c870ec6fe5224011b7b16108c5326f0bcf9d`; database-backed integration and end-to-end tests remain pending.

## Two-account beta acceptance test (Ala + owner)
1. Only after staging migration and admin configuration, have Ala sign in to her existing premium account and submit a harmless test ticket (e.g. `Prueba de soporte ECHO — verificar recepción`). Premium status is unrelated to support permissions.
2. Confirm Ala sees the ticket ID and `open` status in **Mis reportes**.
3. Confirm the owner/admin sees it in `/admin/support` and changes status to `investigating`.
4. Have Ala reload **Mis reportes** and verify the updated status.
5. Confirm Ala cannot access `/support/admin/tickets` or modify tickets; use a separate non-admin account to confirm isolation. Do not ask users to share passwords or tokens.
6. Document results and delete the test ticket only through a reviewed, authorized database operation once retention policy is decided; no delete endpoint currently exists.
