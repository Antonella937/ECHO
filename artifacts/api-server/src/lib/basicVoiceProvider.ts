/**
 * Server-side basic TTS provider boundary.
 * No provider credentials or URLs are ever exposed to browser/mobile clients.
 * The Kokoro-compatible transport preserves the existing production contract.
 * Future async providers must implement this boundary with separate adapters.
 */
export type BasicVoiceRequest = {
  text: string;
  voice: string;
  requestId: string;
};

export class BasicVoiceProviderError extends Error {
  constructor(public readonly code: string) {
    super(code);
    this.name = "BasicVoiceProviderError";
  }
}

function providerEndpoint(): URL {
  const configured = process.env.ECHO_KOKORO_TTS_URL;
  if (!configured) throw new BasicVoiceProviderError("VOICE_ENGINE_NOT_CONFIGURED");
  let url: URL;
  try { url = new URL(configured); }
  catch { throw new BasicVoiceProviderError("VOICE_ENGINE_INVALID_CONFIGURATION"); }
  if (url.protocol !== "https:" || url.username || url.password || url.search || url.hash) {
    throw new BasicVoiceProviderError("VOICE_ENGINE_INVALID_CONFIGURATION");
  }
  return url;
}

export function basicVoiceProviderReady(): boolean {
  try { providerEndpoint(); return true; }
  catch { return false; }
}

/**
 * Returns WAV bytes, preserving the current voice player and private storage.
 * Intentionally rejects non-WAV responses rather than silently storing MP3 as WAV.
 */
export async function synthesizeBasicVoice(request: BasicVoiceRequest): Promise<Buffer> {
  const provider = process.env.ECHO_BASIC_TTS_PROVIDER || "kokoro";
  if (provider !== "kokoro") {
    throw new BasicVoiceProviderError("VOICE_PROVIDER_NOT_IMPLEMENTED");
  }
  const response = await fetch(providerEndpoint(), {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      ...(process.env.ECHO_KOKORO_TTS_KEY
        ? { Authorization: `Bearer ${process.env.ECHO_KOKORO_TTS_KEY}` }
        : {}),
    },
    body: JSON.stringify({
      model: "kokoro", input: request.text, voice: request.voice, response_format: "wav",
    }),
    signal: AbortSignal.timeout(45_000),
  });
  if (!response.ok) throw new BasicVoiceProviderError("VOICE_ENGINE_FAILED");
  const contentLength = response.headers.get("content-length");
  if (contentLength && Number(contentLength) > 15 * 1024 * 1024) {
    throw new BasicVoiceProviderError("VOICE_ENGINE_INVALID_AUDIO");
  }
  const bytes = Buffer.from(await response.arrayBuffer());
  if (bytes.length < 44 || bytes.length > 15 * 1024 * 1024 ||
      bytes.toString("ascii", 0, 4) !== "RIFF" ||
      bytes.toString("ascii", 8, 12) !== "WAVE") {
    throw new BasicVoiceProviderError("VOICE_ENGINE_INVALID_AUDIO");
  }
  return bytes;
}
