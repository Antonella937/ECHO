/** Stable, provider-independent IDs for ECHO's free voice catalogue.
 * These are Kokoro English voices; Spanish requires language-specific voices
 * or an additional multilingual provider. Never silently promise Spanish
 * pronunciation from an English checkpoint.
 */
export const BASIC_VOICES = [
  { id: 'echo-f-01', label: 'Heart', gender: 'female', language: 'en-US', provider: 'kokoro', providerVoiceId: 'af_heart' },
  { id: 'echo-f-02', label: 'Bella', gender: 'female', language: 'en-US', provider: 'kokoro', providerVoiceId: 'af_bella' },
  { id: 'echo-f-03', label: 'Nicole', gender: 'female', language: 'en-US', provider: 'kokoro', providerVoiceId: 'af_nicole' },
  { id: 'echo-f-04', label: 'Emma', gender: 'female', language: 'en-GB', provider: 'kokoro', providerVoiceId: 'bf_emma' },
  { id: 'echo-f-05', label: 'Alice', gender: 'female', language: 'en-GB', provider: 'kokoro', providerVoiceId: 'bf_alice' },
  { id: 'echo-m-01', label: 'Adam', gender: 'male', language: 'en-US', provider: 'kokoro', providerVoiceId: 'am_adam' },
  { id: 'echo-m-02', label: 'Eric', gender: 'male', language: 'en-US', provider: 'kokoro', providerVoiceId: 'am_eric' },
  { id: 'echo-m-03', label: 'Liam', gender: 'male', language: 'en-US', provider: 'kokoro', providerVoiceId: 'am_liam' },
  { id: 'echo-m-04', label: 'Daniel', gender: 'male', language: 'en-GB', provider: 'kokoro', providerVoiceId: 'bm_daniel' },
  { id: 'echo-m-05', label: 'George', gender: 'male', language: 'en-GB', provider: 'kokoro', providerVoiceId: 'bm_george' },
] as const;
export type BasicVoiceId = typeof BASIC_VOICES[number]['id'];
export function getBasicVoice(id: string) { return BASIC_VOICES.find(voice => voice.id === id) ?? null; }
