# ECHO — Public launch checklist

## Access and rollout
- The existing Cloudflare Pages + Render + Neon deployment remains a private beta until deliberately switched.
- `ECHO_ACCESS_MODE=private_beta` is the default; existing `ECHO_BETA_ACCESS_MODE=three_seats` and `ECHO_BETA_ALLOWED_USER_IDS` continue to work.
- Production public mode requires **both** `ECHO_ACCESS_MODE=public` and `ECHO_PUBLIC_LAUNCH_APPROVED=true` with `NODE_ENV=production`. Do not set these on the beta deployment until launch readiness checks pass.
- The public gate verifies Clerk authentication; route-level authorization must still enforce ownership and visibility.
- Existing founder/owner lifetime billing exemptions remain server-authoritative. Audit every future paid add-on checkout and quota before release.

## Required before opening registration
- Publish reviewed Terms, Privacy Policy, acceptable-use rules, content reporting and copyright/takedown processes; validate account deletion and data export.
- Review sharing endpoints for public previews versus authentication, ownership, token revocation and imported content resharing.
- Validate Creator Hub public profile/follow/update privacy and cross-account isolation with at least two unrelated test users.
- Configure Clerk production keys, verified domain, redirects, email delivery and abuse prevention; verify CORS for the official domain.
- Verify subscription webhooks, paid plan enforcement, billing exemption, failed payments and refunds.
- Implement rate limits, quotas and abuse controls for account creation, AI generation, media uploads, follows and DMs.
- Verify storage bucket permissions, file type/size checks, media moderation and signed/private URLs.
- Configure database backups, restore drill, observability, uptime checks, error alerts and spending caps.
- Run automated build, typecheck, route tests, browser E2E tests and mobile accessibility tests on a staging deployment.
- Perform a gradual launch with rollback, incident response and support procedures.

## Launch sequence
1. Keep the current beta live and build/test the public mode with separate staging configuration.
2. Complete security, privacy, billing, abuse-prevention and E2E gates.
3. Connect official domain and production Clerk settings; validate links, cookies and CORS.
4. Explicitly approve public mode and deploy, then monitor and ramp up registrations.

**Current state:** public mode is code-prepared, not production-approved or activated. No claim of release readiness is implied.
