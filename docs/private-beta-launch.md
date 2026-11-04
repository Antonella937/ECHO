# ECHO — private beta launch checklist

Status: **not deployed or verified**. This checklist is for the operator; committing code does not configure hosting, Clerk or PostgreSQL.

## Before opening registration

1. Deploy the React/Vite frontend and Express API with HTTPS. Configure Clerk for the deployed frontend and API. Do not put server secrets in Vite variables.
2. Configure PostgreSQL and apply `scripts/echo-beta-seats.sql` to the **same database** the API uses. The table is required before activating the three-seat mode.
3. Configure API environment:
   - `NODE_ENV=production`
   - `ECHO_BETA_ACCESS_MODE=three_seats`
   - `ECHO_ALLOWED_ORIGINS=https://<actual-frontend-host>` (comma-separated if more than one). Exact origins only, no trailing slash.
   - Valid Clerk keys, database connection, and other required existing API secrets.
4. Configure frontend `VITE_ECHO_PRIVATE_BETA=true` **at build time** and the existing API/Clerk frontend settings. This flag skips legacy browser-state import; it does not erase previously saved server data.
5. Confirm `GET /api/healthz` responds on the deployed API. Do not expose internal database credentials or Clerk secret keys to the browser.
6. Legal documentation and consent are **not finished**: `LEGAL_DOCUMENTS_AVAILABLE=false` and safety middleware intentionally blocks AI/autonomy writes and external sharing. Do not claim full-feature beta until the relevant documents, consent and feature review are complete.

## Three-seat acceptance test

Use four distinct **new** Clerk accounts in an isolated test environment. Seat allocation happens on the first authenticated API request, not at Clerk signup.

- Account A: authenticated API call succeeds, claims seat 1; fresh onboarding begins.
- Account B: same for seat 2; cannot read A's data.
- Account C: same for seat 3; cannot read A/B data.
- Account D: API responds 403 `PRIVATE_BETA_FULL`; UI explains the capacity limit. Clerk may still have created the fourth login identity, so do not describe this as a Clerk signup cap.
- Reload A/B/C, including on mobile: their seat persists and their own universe data remains.
- Concurrent first requests from two new accounts with one seat remaining: exactly one must succeed.
- Temporarily make the seat table unavailable in a **test** environment: API responds 503 `PRIVATE_BETA_UNAVAILABLE` and does not admit another account.
- Verify frontend onboarding from the landing screen with new accounts; `VITE_ECHO_PRIVATE_BETA` does not reset an already-saved server universe.

## Before sending invitations

- Run CI typecheck and targeted backend tests; test signup, onboarding, creation, saving, logout/login, mobile scrolling, all links, and error screens in a deployed environment.
- Verify billing is not connected and beta limits are five universes and twenty-five characters per account. These are capacity limits, not proof that all paid features work.
- Confirm consent and safety behavior for the actual tester cohort; do not bypass legal/safety gates to make the demo appear complete.
- Keep the URL private and monitor API errors. A shared URL is not an access-control mechanism; the server seat gate is.

## Important caveat

The first three authenticated identities to reach the API claim the seats. If the operator needs to guarantee particular people receive seats, the first-come-first-served flow is insufficient; arrange controlled signup or a reservation/invitation mechanism before distributing the link. Never delete a seat row from production casually: it changes who can access the beta.
