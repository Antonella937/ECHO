# ECHO basic TTS: hosted-provider migration plan (2026-11-08)

## Decision
Keep the existing ECHO backend as the sole client-facing TTS gateway for web and future mobile clients. Do not provision a new always-on Kokoro server for beta. Preserve the existing ten Kokoro voice IDs and ElevenLabs premium path.

## Current implementation (verified on main)
- `artifacts/api-server/src/routes/basic-voice.ts` synthesizes/listens using `ECHO_KOKORO_TTS_URL`, optional `ECHO_KOKORO_TTS_KEY`, synchronous WAV response and 45-second timeout.
- `artifacts/api-server/src/autonomy/voice-adapter.ts` sends the same request and stores WAV in private Supabase media.
- Usage/entitlement limits exist; these must be preserved, including refunds on provider failures.
- Voice IDs: af_heart, af_bella, af_nicole, bf_emma, bf_alice, am_adam, am_eric, am_liam, bm_daniel, bm_george.

## Provider candidates (verify terms and prices before activating billing)
- deAPI Kokoro: published $0.00077 per 1,000 chars; $5 initial credits claimed, asynchronous job/polling, MP3 URL result. API differs from current synchronous WAV endpoint.
- DeepInfra Kokoro: third-party comparison cites ~$0.99 per 1M chars; independently confirm official price, voice list, request/response contract, and latency.
- fal.ai Kokoro: official $0.02 per 1,000 chars, English model has 19 American voices; check British voice availability on separate model endpoint.

## Implementation sequence (no paid requests yet)
1. Introduce server-only TTS provider adapter `synthesize({ text, voiceId, requestId }): Promise<Buffer>` with provider-specific transport. Preserve Kokoro adapter and allow provider selection by environment setting; do not expose credentials to browser/mobile.
2. Verify each provider supports all ten configured voices; handle language/model routing, not just American English.
3. For asynchronous providers: submit, poll with bounded retries/deadline, download result from trusted allowlisted host, validate size and content; convert to WAV server-side only if required or update media handling for MP3 safely. Never assume a remote URL is safe to fetch.
4. Keep usage reservation, entitlement, idempotency, 30-second audio cap, private storage, and failure refunds intact. Avoid double-charging on retries.
5. Add unit tests with mocked provider calls for successful WAV/MP3, pending jobs, timeouts, errors, unexpected hosts, rate limits, and Spanish/English samples.
6. Set provider keys and hard spending limits in Render only after provider selection and user approval; test with minimal trial credit, then enable beta cohort.

## Launch architecture
Web and future iOS/Android apps -> ECHO API -> provider adapter -> hosted TTS now / self-hosted Kokoro later. No client-side provider keys. Track cost per 1,000 chars, p95 latency, failure rate, and daily volume before considering self-hosting.

## Safety
Do not paste API keys into GitHub. Do not activate paid provider or create infrastructure without explicit approval.
