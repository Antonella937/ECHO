# ECHO AI Engine v1 — checkpoint 1

Backend-only, text-only, manual previews. No UI, scheduler, social event dispatcher,
write repository, memory promotion, multimedia analysis or autonomous worker.

## Manual API

`POST /api/ai-engine/preview` requires the existing authenticated owner session.
The owner ID comes exclusively from Clerk, not the request or fictional identity.

```json
{"characterId":"mar","situation":"post"}
```

For `comment`, supply a real `postId` with comments enabled. For `dm`, supply
another available character's `recipientId`. The owner must explicitly call each
preview. There is no automatic call on login, navigation or social interaction.

The result has `mode: "preview"`, `executed: false`, a source revision and a
validated `decision`:
- `action: "none"` with null text, or `"draft"` with bounded text.
- Situation, brief reason, suggested delay (never scheduled), and context sections.
- Provider/model and honest missing/truncated-context warnings.

Never pass this response to social mutations without a separate, future,
explicitly approved execution layer. Checkpoint 1 has no such layer.

## Isolation and context

Only the authenticated owner's persisted snapshot is read. The character may
differ from the currently active identity, without switching it. The context
contains actual profile/configuration, voice, relationships (owner is separate
from Nela), routine with local time, social preferences, editable memory and
current state. Routines remain probabilistic; current state retains its source.

Recent social context is bounded. DM text is included only for the character and
the requested counterpart, excluding hidden messages. Never include another
pair's private conversations. Media contributes only item IDs, order and type,
not bytes, URLs, vision or audio claims. Missing configuration stays null.
Very large context fails explicitly; bounded fields carry a truncation warning.

## Provider

`TextProvider` is injected into pure orchestration. `OpenRouterProvider` uses the
existing backend-only `OPENROUTER_API_KEY`. Default routing is `openrouter/free`;
paid model IDs are rejected. This stage has no paid fallback or automatic retry.
Free capacity, latency and availability can vary. Errors and malformed/truncated
JSON fail explicitly, without fabricated drafts or social writes.

This explicit preview sends the selected character's textual context to
OpenRouter/the selected inference provider. Credentials, raw provider errors,
character context and generated text are not logged or stored by ECHO.
No guarantee is made about an external provider's retention policy.

Requests are limited to one concurrent generation per owner plus a short
cooldown in this server process. This is a cost guard, not a distributed quota.

## Tests

From the workspace:
`pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/tests/ai-engine.test.ts`

Deterministic tests inject a fake provider and explicitly enriched test fixtures.
They make no network calls, create no social content and never modify the real
character. A live smoke check must be explicitly run; never run it on startup
or in CI. A new free provider response still needs schema/semantic validation:
coherent style cannot be guaranteed by schema alone.

Optional explicit live test (not part of automated tests):
`pnpm --filter @workspace/scripts exec tsx tests/echo-ai-live-check.ts --live`

Without `--owner-id`, this uses Mar's actual initial ECHO profile, not a guessed
private owner's universe. Add `--owner-id <authenticated-owner-id>` only when
that owner has explicitly been selected. `--situation post|comment|dm` bounds
the test to one request; `--model <id:free>` selects a free model manually.
The test stops on the first provider/validation failure and never retries.
Free-routing responses can be truncated or rate-limited: these are not proof of
a completed decision, and must not be substituted by mock successes.
