/**
 * ElevenLabs voice-design integration boundary.
 * No network requests are made unless explicitly enabled AND a server-side key exists.
 * Never expose the key to browser clients or store it in a character record.
 */
export function elevenLabsVoiceStatus() {
  const keyPresent = Boolean(process.env.ELEVENLABS_API_KEY?.trim());
  const enabled = process.env.ECHO_ELEVENLABS_VOICE_DESIGN_ENABLED === "true";
  return { provider:"elevenlabs" as const, configured:keyPresent, generationAvailable:keyPresent && enabled,
    reason:!keyPresent?"ELEVENLABS_KEY_MISSING":!enabled?"VOICE_DESIGN_DISABLED":null };
}
export function elevenLabsHeaders(): Record<string,string> {
  const key=process.env.ELEVENLABS_API_KEY?.trim();
  if (!key || process.env.ECHO_ELEVENLABS_VOICE_DESIGN_ENABLED !== "true") throw Error("ELEVENLABS_NOT_ENABLED");
  return { "xi-api-key":key, "Content-Type":"application/json" };
}
