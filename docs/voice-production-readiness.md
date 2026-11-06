# ECHO: voice production integration checklist (no paid requests)

## What is verified
- Selected Kokoro basic voice persists on character profile.
- Pre-generated WAV plays in direct messages.
- The audio transcript can be read by the character in the recent chat context.
- None of this proves dynamic synthesis, paid provider integration, or long-term recall.

## Current server routes
- POST /voices/basic/synthesize: HTTPS Kokoro-compatible TTS; needs ECHO_KOKORO_TTS_URL and optional server-only key; returns WAV bytes, not a saved attachment.
- POST /voices/basic/attach-to-dm: attaches an existing owner-owned private WAV to a character-authored message; not yet invoked by automatic AI replies.
- No production voice-design or voice-cloning provider is connected.

## Build next
1. After a character text reply is committed, fetch its exact text server-side, synthesize only with user opt-in, upload to owner-private storage, attach to same DM idempotently, and display with existing audio player. Keep text and memory independent of TTS failures.
2. Add per-character voice modes: basic preset; original AI-designed voice from text prompt; verified-consent cloned voice from private audio.
3. Prompt mode: provider must support voice design; collect description (language, accent, timbre, pitch, pace, expressiveness). Do not label preset selection as new voice generation.
4. Clone mode: explicit speaker authorization, provider-required verification, private reference storage, consent revocation and voice deletion. Never upload samples to public GitHub. Disclose synthetic speech; refuse unconsented impersonation.
5. Use server-only credentials, provider capability checks, owner quotas and hard budget ceilings, clear failures, idempotency and secure deletion. Do not incur charges before owner activates billing.
6. Validate Spanish/English, iPhone playback, private object ownership, retries, concurrency, memory, and deployment logs.

## Decisions needed before provider implementation
- Paid provider(s) supporting both voice design and consent-based cloning, or separate providers for each.
- Basic voices: self-host Kokoro or pay for a hosted endpoint.
- Generate voice automatically on every DM or only on request (cost and latency).
- Consent verification and reference-audio retention/deletion policy.

## Provider interface target
- synthesize({text, voiceId, language, requestId}) -> private WAV
- designVoice({prompt, requestId}) -> providerVoiceId (capability required)
- cloneVoice({privateAudioRef, verifiedConsent, requestId}) -> providerVoiceId (capability and authorization required)
- deleteVoice({providerVoiceId}) -> deletion/revocation
