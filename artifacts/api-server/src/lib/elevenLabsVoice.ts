/**
 * ElevenLabs voice-design integration boundary.
 * No network requests are made unless explicitly enabled AND a server-side key exists.
 * Never expose the key to browser clients or store it in a character record.
 */
export function elevenLabsVoiceStatus(ownerId?: string) {
  const keyPresent = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  const scopedOwner = process.env.ECHO_ELEVENLABS_PAID_TEST_OWNER_ID?.trim();
  const ownerAllowed = !scopedOwner || (Boolean(ownerId) && ownerId === scopedOwner);
  const enabled = process.env.ECHO_ELEVENLABS_VOICE_DESIGN_ENABLED === "true" && ownerAllowed;
  return { provider:"elevenlabs" as const, configured:keyPresent, generationAvailable:keyPresent && enabled,
    reason:!keyPresent?"ELEVENLABS_KEY_MISSING":!enabled?"VOICE_DESIGN_DISABLED":null };
}
export function elevenLabsHeaders(): Record<string,string> {
  const key=process.env.ELEVENLABS_API_KEY?.trim();
  if (!key || process.env.ECHO_ELEVENLABS_VOICE_DESIGN_ENABLED !== "true") throw Error("ELEVENLABS_NOT_ENABLED");
  return { "xi-api-key":key, "Content-Type":"application/json" };
}

/** Additional paid voice creation requires a separate, explicit rollout. */
export function elevenLabsCreationAllowed(ownerId: string): boolean {
  return elevenLabsVoiceStatus(ownerId).generationAvailable && process.env.ECHO_ELEVENLABS_VOICE_CREATION_ENABLED === "true";
}
