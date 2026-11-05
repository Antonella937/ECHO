# ECHO private-beta text autonomy activation checklist

Status: preparation only. This document does not authorize live execution or change the production gate.

## Scope
- Text-only: posts, comments, likes, reactions, direct messages.
- AI image generation remains disabled.
- Owner-specific, universe-specific, opt-in character controls and global emergency stop.

## Before enabling production
1. Publish reviewed, accessible Terms of Use and Privacy Policy with a version and effective date. Identify ECHO as an individual creator's personal project (not a company), with the creator as the responsible operator; confirm the appropriate public legal identity and contact without inventing a company; describe AI text providers, data transfers, retention, user rights, account deletion, minors, and automated fictional content. Obtain appropriate legal review for the applicable jurisdictions.
2. Implement server-side, versioned acceptance of those specific published documents for each owner. The existing `alpha-draft-1` acknowledgement is not legal consent.
3. Enforce valid acceptance in the backend for every live autonomous cycle, not only the frontend switch; refuse execution on withdrawal or superseded terms.
4. Verify provider budget protection, free-only text models, idempotency, cooldown, daily caps, ownership and universe isolation, lease recovery, and immediate kill-switch effect.
5. Test executor and worker against a disposable isolated Neon branch with test accounts and no real private conversations.
6. Verify the browser controls and honest status messaging, including errors and pending actions.
7. Enable only after explicit operator approval; start with one test character and monitor logs. Roll back immediately if privacy or duplication fails.

## Production gate (currently intentionally closed)
- `artifacts/api-server/src/lib/ownerConsent.ts`: `LEGAL_DOCUMENTS_AVAILABLE = false`
- `artifacts/api-server/src/autonomy/constants.ts`: requires production, `ECHO_AUTONOMY_LIVE_ENABLED=true`, and legal documents.
- `artifacts/api-server/src/index.ts`: worker only starts if legal documents are available.
- `artifacts/echo/src/components/echo/autonomy-settings.tsx`: switches can record intended opt-in but must not imply live execution while disabled.

## Acceptance tests
- A character opted out never acts; the owner kill switch prevents all new actions.
- A character opted in executes at most its daily cap, respecting cooldowns and owner budget.
- Duplicate tick/idempotency key never creates duplicate posts, likes, comments or DMs.
- No actions or memory from owner A are visible to owner B.
- Actions persist after reload and can be audited.
- Image generation never executes.
