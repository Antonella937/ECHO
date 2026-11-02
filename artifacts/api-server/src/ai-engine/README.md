# ECHO AI Engine v1 — checkpoint 2

Backend-only, manual, text-only proposals. No UI changes, autonomous workers,
social writes, memory promotion, scheduling, media analysis or multimedia calls.

## Owner-scoped previews

`POST /api/ai-engine/preview` uses the existing private session. The owner ID
comes only from verified authentication, not request JSON or the active fictional
identity. `previewForOwner` reads the latest persisted snapshot each time.
Missing owner/universe/character fails explicitly. There is NO seed/demo lookup.

Inputs: `{ "characterId": "mar", "situation": "post" }`; for `comment` add a
real `postId` with comments enabled; for `dm` add an available `recipientId`.
Unknown input fields (including supplied owner IDs, contexts and model IDs)
are rejected. The active identity and stored universe are never changed.

The response always says `mode: "preview"`, `executed: false`. A decision is
`none` with null text, or `draft` with bounded text. Suggested delay is never
scheduled. The response must NOT be wired to social mutations without a separate,
future, explicitly approved execution layer.

## Real context and provenance

Context consumes persisted identity/basic fields, personality, voice,
relationships, timezone/routine, social settings, permanent/relationship/recent
memories, current state and bounded relevant social history. Owner remains
distinct from Nela/the actor. A routine is probabilistic; a manually supplied
state is not an autonomous observation.

Only the actor/requested counterpart's visible DM history is included. Unrelated
private conversations, provider IDs, credentials, file URLs and media bytes are
excluded. Ordered media IDs/types are metadata, not vision/audio understanding.
Missing configuration stays missing; persisted empty defaults are not described
as a developed personality.

`contextAudit` reports the persisted/provided-snapshot source, source revision,
character, exact context SHA-256, included field paths, substantive-section flags,
bounded recent-record counts and private-DM scope. It contains no private field
values. This is provenance, not proof that a model followed every fact correctly.

`decision.contextSections` is a model self-report, not independent evidence.
Raw prompts/context, provider error bodies, credentials and generated text are
not put in server logs or the database.

## Free provider robustness

`TextProvider` is injected; `OpenRouterProvider` handles a single text request.
`FreeModelProvider` checks the public catalog (cached 5 minutes), accepts only
`:free` IDs with explicitly zero prompt/completion/request pricing and text
input/output support. It excludes safety/code-only choices. Paid fallback and
the generic unpriced router are not used by this fallback layer.

At most 3 distinct model requests and 75 seconds per explicit preview. One request
has a 25-second timeout and 2600 output-token ceiling. Supported JSON mode and
reasoning-disable options are capability-dependent, not blindly sent.

Timeouts, 429, provider failures, truncation and invalid structured output can
move to another free model. No retry loop against the same model, hidden worker,
automatic later retry or mock fallback. Retry-After is honored as a per-model
cooldown; another model may be tried immediately. Cooldowns are shared across
owners in this process, without storing owner context. Missing key, authentication
failures, unverified paid response models or nonzero reported cost fail closed.

The owner route also retains its existing concurrency/cooldown guard. Limits
are process-local, not distributed quotas. Free capacity is not guaranteed.

Every attempt reports sanitized model/outcome/error-code and known usage.
`cost: null` means not reported, NEVER inferred zero. Invalid-output usage is
retained. Success `usage` is for the accepted response; inspect all attempts
when accounting for total tokens/cost.

## Explicit live validation — persisted characters only

From `@workspace/scripts`:

`tsx tests/echo-ai-live-check.ts --live --owner-id <explicit-owner> --character-id mar --report ../generated-artifacts/ai-engine/checkpoint-2.json`

The owner must be explicitly selected by the operator; the script does not guess
between private universes. No owner -> no network request. It requires an existing
persisted personality description/traits; no personality -> a blocked report,
not invented enrichment. Optional `--situation post|comment|dm` limits the run.

Each separate scenario consumes a freshly read owner snapshot, continues after
other scenarios fail, records the exact structured decision/text or failure,
context audit, model attempts and reported usage, and checks the universe
revision/content afterward. Concurrent changes are reported, never restored.

Reports are private operator output. Optional disk reports are restricted to
`generated-artifacts/ai-engine/`, ignored by Git and publishing, mode 0600. They
may contain private generated text: do not present them as public artifacts,
copy them into memory, or log them from the server.

## Tests and interpretation

`pnpm --filter @workspace/scripts exec tsx --test ../artifacts/api-server/tests/ai-engine*.test.ts`

Tests cover structured output, context/DM isolation, free-only selection,
fallback/cooldown/budgets/usage, and real PostgreSQL reads of isolated synthetic
test owners. The latter are persisted integration fixtures with mocked inference:
they do NOT qualify as real-character or live OpenRouter results.
