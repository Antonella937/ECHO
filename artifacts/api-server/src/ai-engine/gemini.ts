import { EngineError, ProviderFailure, unknownUsage, type TextProvider } from './contracts';
import { FreeModelProvider } from './free-models';

/** Gemini for conversational DMs; retain the existing free-model fallback.
 * Never log API keys, prompts, provider response bodies, or character messages.
 */
export class GeminiDmProvider implements TextProvider {
  readonly name = 'gemini';
  constructor(private readonly fallback: TextProvider = new FreeModelProvider(), private readonly request: typeof fetch = fetch) {}
  async complete(input: Parameters<TextProvider['complete']>[0]) {
    const key = process.env.GEMINI_API_KEY;
    if (!key) return this.fallback.complete(input);
    const model = process.env.ECHO_GEMINI_TEXT_MODEL || 'gemini-2.5-flash-lite';
    // Preserve existing OpenRouter path for non-DM autonomous activity.
    if (!input.system.includes('DM conversation preferences') && !input.system.includes('live character DM reply engine')) {
      return this.fallback.complete(input);
    }
    try {
      const response = await this.request(
        `https://generativelanguage.googleapis.com/v1beta/models/${encodeURIComponent(model)}:generateContent`,
        { method: 'POST', signal: AbortSignal.timeout(25000),
          headers: { 'Content-Type': 'application/json', 'x-goog-api-key': key },
          body: JSON.stringify({
            systemInstruction: { parts: [{ text: input.system }] },
            contents: [{ role: 'user', parts: [{ text: input.context }] }],
            generationConfig: { responseMimeType: 'application/json', maxOutputTokens: 2600, temperature: input.conversationMode === 'narrative' ? 0.9 : 0.75 },
          }),
        });
      if (!response.ok) {
        await response.body?.cancel();
        throw new ProviderFailure(response.status === 429 ? 'GEMINI_RATE_LIMITED' : `GEMINI_HTTP_${response.status}`, response.status === 429 ? 429 : 502, true);
      }
      const body = await response.json() as {
        candidates?: Array<{ content?: { parts?: Array<{ text?: string }> }; finishReason?: string }>;
        usageMetadata?: { promptTokenCount?: number; candidatesTokenCount?: number };
      };
      const candidate = body.candidates?.[0];
      const output = candidate?.content?.parts?.map(part => part.text || '').join('') || '';
      if (!output || (candidate?.finishReason && candidate.finishReason !== 'STOP')) throw new ProviderFailure('GEMINI_INCOMPLETE_RESPONSE', 502, true);
      input.validate?.(output);
      const usage = { promptTokens: body.usageMetadata?.promptTokenCount ?? null, completionTokens: body.usageMetadata?.candidatesTokenCount ?? null, cost: null };
      return { text: output, model, usage, attempts: [{ model, outcome: 'success' as const, code: null, usage }] };
    } catch (error) {
      // Do not hide semantic/character validation failures behind a second model.
      if (error instanceof EngineError && !(error instanceof ProviderFailure)) throw error;
      try { return await this.fallback.complete(input); }
      catch (fallbackError) { throw fallbackError instanceof EngineError ? fallbackError : new EngineError('TEXT_PROVIDERS_UNAVAILABLE', 503); }
    }
  }
}
