import { EngineError, ProviderFailure, unknownUsage, type TextProvider } from './contracts';
import { FreeModelProvider } from './free-models';

/** Gemini for conversational DMs; retain the existing free-model fallback.
 * Never log API keys, prompts, provider response bodies, or character messages.
 */
export class GeminiDmProvider implements TextProvider {
  readonly name = 'gemini';
  constructor(private readonly fallback: TextProvider = new FreeModelProvider(), private readonly request: typeof fetch = fetch, private readonly ownerId?: string) {}
  private async completePaidDm(input: Parameters<TextProvider['complete']>[0]) {
    const narrative = input.conversationMode === 'narrative';
    const founder = this.ownerId === 'user_3LeoBfUicTthDVixNbkPlqXFkdZ';
    const model = narrative || founder ? 'openai/gpt-4.1-mini' : 'openai/gpt-4.1-nano';
    const maxTokens = narrative ? (founder ? 2200 : 1600) : (founder ? 1100 : 700);
    let response: Response;
    try {
      response = await this.request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(25000),
        headers: { Authorization: `Bearer ${process.env.OPENROUTER_API_KEY}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model, stream: false, max_tokens: maxTokens, temperature: narrative ? 0.85 : 0.75,
          response_format: { type: 'json_object' },
          messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.context }] }),
      });
    } catch { throw new ProviderFailure('OPENROUTER_PAID_CONNECTION_FAILED', 502, true); }
    if (!response.ok) {
      await response.body?.cancel();
      throw new ProviderFailure(response.status === 429 ? 'OPENROUTER_PAID_RATE_LIMITED' : `OPENROUTER_PAID_HTTP_${response.status}`, 502, true);
    }
    const body = await response.json() as { choices?: Array<{message?: {content?: string};finish_reason?: string}>; usage?: {prompt_tokens?: number;completion_tokens?: number;cost?: number} };
    const choice = body.choices?.[0];
    if (choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string') throw new ProviderFailure('OPENROUTER_PAID_INCOMPLETE', 502, true);
    input.validate?.(choice.message.content);
    const usage = { promptTokens: body.usage?.prompt_tokens ?? null, completionTokens: body.usage?.completion_tokens ?? null, cost: body.usage?.cost ?? null };
    return { text: choice.message.content, model, usage, attempts: [{ model, outcome: 'success' as const, code: null, usage }] };
  }

  async complete(input: Parameters<TextProvider['complete']>[0]) {
    // Paid OpenRouter is opt-in. Only conversational DMs use it; social autonomy
    // keeps the existing free route. No retry to a second paid model.
    const isDm = input.system.includes('DM conversation preferences') || input.system.includes('live character DM reply engine');
    if (isDm && process.env.ECHO_OPENROUTER_PAID_TEXT_ENABLED === 'true' && process.env.OPENROUTER_API_KEY) {
      try { return await this.completePaidDm(input); }
      catch (error) {
        // Fall back to zero-cost models; never trigger another paid request.
        if (error instanceof EngineError && !(error instanceof ProviderFailure)) throw error;
        return this.fallback.complete(input);
      }
    }
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
