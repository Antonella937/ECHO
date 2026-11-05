# ECHO image generation — production activation checklist

## Current implementation (as of 2026-11-05)

- The authenticated `POST /api/ai-engine/images/prepare` previews a server-built character prompt without paid requests.
- The authenticated `GET /api/ai-engine/images/status` returns conservative, non-secret preflight flags. Its `enabled` field remains `false` until production activation is actually verified.
- `POST /api/ai-engine/images/generate` is wired to the service, but is gated by **both** `ECHO_PAID_IMAGE_GENERATION_ENABLED=true` and `ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED=true`, plus a per-user allowlist. Leave both switches OFF until the checklist below is completed.
- The service reads owner-verified private references, reserves a global monthly budget atomically, performs one provider request, stores the result privately and settles the ledger. Failures with uncertain provider billing retain the reservation conservatively.
- The image generation provider adapter and HTTP transport have offline/mock tests. Green CI means these code tests pass, **not** that the real provider, production database, Supabase or Render has been tested.
- The frontend contains a generation preview and accept/discard workflow. Confirm it end-to-end before claiming it is operational.

## Remaining prerequisites — in order

1. **Provider contract verification:** independently confirm the exact supported OpenRouter endpoint, model identifier, reference-image request structure, response format, whether `usage.cost` is always returned, and pricing. Do not set `ECHO_IMAGE_PROVIDER_CONTRACT_VERIFIED=true` merely because mock tests pass. If the provider does not return an authoritative cost, implement an alternative authoritative cost lookup or fail closed.
2. **End-to-end tests:** test route authorization, active-character validation, private reference ownership, budget reservation and settlement, and image acceptance using mock provider/storage. Test denial when flags, allowlist or budget are missing.
3. **Production database:** apply `lib/db/src/migrations/20261105-image-generation-budget.sql` through the established migration process and verify both tables exist. The monthly ceiling defaults to zero. Do not infer successful migration from a GitHub commit.
4. **Private storage:** verify the Supabase `echo-media` bucket and object registration are configured, and test that another account cannot access references or generated media.
5. **Owner-only access:** configure `ECHO_IMAGE_GENERATION_ALLOWED_USER_IDS` with only the owner's authenticated user ID in Render. Do not grant access to other users for the initial test.
6. **Budget:** obtain explicit owner approval for a small USD global monthly spending cap; configure the database ceiling for the correct UTC month, and confirm reservation, consumption and failure accounting. A provider key or prepaid credits do not set a spending cap.
7. **Credentials:** the owner creates a restricted OpenRouter key and adds `OPENROUTER_API_KEY` to Render's backend environment only. Never send it in chat, commit it, or expose it in frontend code.
8. **Activation:** only after verifying all previous steps, enable the two feature flags, confirm status and the real provider contract, and perform exactly one owner-approved paid test. Inspect actual cost and likeness before any second test.

## Safety invariants

- **No automatic retries** of ambiguous provider failures; they might have been billed.
- **No generation without atomic reservation** and a strictly positive database ceiling.
- **No unapproved publication:** a generated image must be accepted by the user before it becomes a post or story.
- **No cross-account media:** references and generated images must remain owner-scoped.
- **No automatic public rollout:** beta access is explicitly allowlisted.
- The existing AI usage “units” are not USD and cannot replace the spending ledger.

## Known caveat

The `imageGenerationAvailability()` status intentionally reports `enabled: false` and a zero budget, even if an operator configures flags. This is conservative, but means the frontend will not offer live generation until a **database-backed readiness/status implementation** is completed. Do not flip paid flags as a shortcut.
