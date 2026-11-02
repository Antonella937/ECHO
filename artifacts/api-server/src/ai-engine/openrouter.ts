import { EngineError, type TextProvider } from './contracts';

/** No SDK coupling. Only free model IDs; no automatic retry or paid fallback. */
export class OpenRouterProvider implements TextProvider {
  readonly name = 'openrouter';
  constructor(private readonly model = 'openrouter/free', private readonly request: typeof fetch = fetch) {
    if (model !== 'openrouter/free' && !model.endsWith(':free')) throw new EngineError('FREE_MODEL_REQUIRED');
  }
  async complete(input: Parameters<TextProvider['complete']>[0]) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new EngineError('OPENROUTER_NOT_CONFIGURED', 503);
    let response: Response;
    try {
      response = await this.request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(45000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: false, max_tokens: 1800, reasoning: { enabled: false },
          messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.context }] }),
      });
    } catch { throw new EngineError('OPENROUTER_CONNECTION_FAILED', 502); }
    // Never pass through provider bodies/headers, which may contain private context.
    if (!response.ok) throw new EngineError(response.status === 429 ? 'OPENROUTER_RATE_LIMITED' : `OPENROUTER_REJECTED_REQUEST_HTTP_${response.status}`, response.status === 429 ? 429 : 502);
    let body: { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; model?: string; error?: unknown };
    try { body = await response.json() as typeof body; } catch { throw new EngineError('INVALID_PROVIDER_RESPONSE', 502); }
    if (!body || typeof body !== 'object') throw new EngineError('INVALID_PROVIDER_RESPONSE', 502);
    const choice = body.choices?.[0];
    if (body.error || choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string' ||
      typeof body.model !== 'string' || !body.model.endsWith(':free'))
      throw new EngineError('INCOMPLETE_PROVIDER_RESPONSE', 502);
    return { text: choice.message.content, model: body.model };
  }
}
