# ECHO Kokoro hosting preparation (no deployment or charges)

## Recommended beta architecture
Keep ECHO API on Render. Host Kokoro-FastAPI separately on Railway Hobby with CPU Docker. Do not enable paid infrastructure before approving the monthly spend.

Upstream CPU container: `ghcr.io/remsky/kokoro-fastapi-cpu` (pin a verified release tag instead of `latest` before deployment).
Kokoro serves an OpenAI-compatible `POST /v1/audio/speech` endpoint, with JSON `{ "model":"kokoro", "input":"...", "voice":"af_heart", "response_format":"wav" }`.

## ECHO backend settings (Render, server-side only)
- `ECHO_KOKORO_TTS_URL=https://<approved-kokoro-host>/v1/audio/speech` (FULL endpoint, not the base URL).
- `ECHO_KOKORO_TTS_KEY=<secret>` (match Kokoro's `API_KEYS` setting).
- Kokoro: configure `API_KEYS` as a JSON array of strong keys; enable HTTPS, keep debug endpoints disabled.
- Do not expose keys in the frontend, GitHub, or screenshots.

## Pre-payment checklist
1. Verify Railway project limits, memory needs, Docker image tag, and projected monthly cost.
2. Confirm Railway container exposes port 8880 and provides HTTPS routing.
3. Test health and one short WAV on the private deployment, with a capped budget.
4. Verify ECHO API's 45-second timeout, 30-second WAV duration, credits and refund handling.
5. Set spending alerts/limits where available. Usage alerts alone are not hard spending caps.
6. Approve hosting charges explicitly before deploying.

## Current state
ECHO already has `/voices/basic/synthesize` and `/voices/basic/listen`. No Kokoro deployment is created by this document.
