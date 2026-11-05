# ECHO image generation — preflight (no paid calls)

## Implemented scaffolding
- Authenticated /api/ai-engine/images/prepare reads the active character and server-side visual identity; it returns a text preview, not a generated image.
- /api/ai-engine/images/status returns disabled and non-secret setup flags.
- /api/ai-engine/images/generate rejects all requests with HTTP 503.
- Owner-scoped reference reader in src/lib/imageReferences.ts reads image bytes from private Supabase storage.
- src/lib/generatedImageStorage.ts stores a validated image as a private /objects/uploads/... asset.
- lib/db/src/schema/echo-image-budget.ts and lib/db/src/migrations/20261105-image-generation-budget.sql define the global USD ledger, defaulting to zero.
- src/lib/imageBudget.ts implements atomic reservation and conservative settlement.

## Must complete before first generation
1. Verify the actual OpenRouter image model ID, image-generation request/response shape, image reference support and current pricing with the provider. The model constant is a placeholder, not a verified contract.
2. Build and test the API and frontend. No CI/build success has been confirmed for these commits.
3. Apply the SQL migration to the actual production database; verify it completed.
4. Implement the provider adapter (request, response parsing, MIME validation, cost accounting). Keep image generation disabled until this is tested against a mock provider.
5. Wire the authenticated /generate endpoint to validate the active character, load owned references, reserve budget atomically BEFORE the paid request, call the provider exactly once, store the image privately, and settle the job in all outcomes.
6. Wire the generated image preview and acceptance/publishing flow in the frontend. Do not publish an unapproved generation automatically.
7. Decide and explicitly approve a USD monthly global cap. Set it in the database only after provider tests. It currently defaults to $0.
8. Tomorrow: owner adds OPENROUTER_API_KEY as a secret to the Render API service (not the frontend, repository or chat). Confirm credentials and credits. Never commit API keys.
9. Perform one explicitly approved paid test image, review cost and likeness.

## Important safety
The existing AI usage "units" are not money. Do not use them to enforce USD spending.
A provider timeout may still incur charges: no automatic retries; retain full budget reservation when cost is unknown.
Do not enable autonomous image generation until explicit user approval and separate rate/cost controls.
