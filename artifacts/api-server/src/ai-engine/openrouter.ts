import { ProviderFailure, EngineError, unknownUsage, type EngineUsage, type TextProvider } from './contracts';

interface ModelOptions { timeoutMs?: number; jsonMode?: boolean; disableReasoning?: boolean }
const numeric = (n: unknown) => typeof n === 'number' && Number.isFinite(n) && n >= 0 ? n : null;
export function extractUsage(body: unknown): EngineUsage {
  const usage = body && typeof body === 'object' && 'usage' in body ? body.usage : null;
  if (!usage || typeof usage !== 'object') return unknownUsage();
  return {
    promptTokens: numeric('prompt_tokens' in usage ? usage.prompt_tokens : null),
    completionTokens: numeric('completion_tokens' in usage ? usage.completion_tokens : null),
    cost: numeric('cost' in usage ? usage.cost : null),
  };
}
function retryAfter(header: string | null) {
  if (!header) return 30000;
  const seconds = Number(header);
  const ms = Number.isFinite(seconds) ? seconds * 1000 : Date.parse(header) - Date.now();
  return Math.min(3600000, Math.max(1000, Number.isFinite(ms) ? ms : 30000));
}

/** One bounded free request; cross-model fallback belongs to FreeModelProvider. */
export class OpenRouterProvider implements TextProvider {
  readonly name = 'openrouter';
  constructor(private readonly model = 'openrouter/free', private readonly request: typeof fetch = fetch,
    private readonly options: ModelOptions = {}) {
    if (model !== 'openrouter/free' && !model.endsWith(':free')) throw new EngineError('FREE_MODEL_REQUIRED');
  }
  async complete(input: Parameters<TextProvider['complete']>[0]) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new EngineError('OPENROUTER_NOT_CONFIGURED', 503);
    let response: Response;
    try {
      response = await this.request('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST', signal: AbortSignal.timeout(this.options.timeoutMs ?? 25000),
        headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
        body: JSON.stringify({ model: this.model, stream: false, max_tokens: 2600,
          ...(this.options.jsonMode ? { response_format: { type: 'json_object' } } : {}),
          ...(this.options.disableReasoning ? { reasoning: { enabled: false } } : {}),
          messages: [{ role: 'system', content: input.system }, { role: 'user', content: input.context }] }),
      });
    } catch { throw new ProviderFailure('OPENROUTER_CONNECTION_FAILED', 502, true); }
    if (!response.ok) {
      // Never consume or expose the provider's potentially sensitive error text.
      await response.body?.cancel();
      throw new ProviderFailure(response.status === 429 ? 'OPENROUTER_RATE_LIMITED' : `OPENROUTER_REJECTED_REQUEST_HTTP_${response.status}`,
        response.status === 429 ? 429 : 502,
        [400, 404, 408, 409, 429].includes(response.status) || response.status >= 500,
        response.status === 429 ? retryAfter(response.headers.get('Retry-After')) : 0);
    }
    let body: unknown;
    try { body = await response.json(); } catch { throw new ProviderFailure('INVALID_PROVIDER_RESPONSE', 502, true); }
    const usage = extractUsage(body);
    if (!body || typeof body !== 'object') throw new ProviderFailure('INVALID_PROVIDER_RESPONSE', 502, true, 0, usage);
    const envelope = body as { choices?: { message?: { content?: unknown }; finish_reason?: string }[]; model?: unknown; error?: unknown };
    const choice = Array.isArray(envelope.choices) ? envelope.choices[0] : undefined;
    if (usage.cost !== null && usage.cost > 0) throw new ProviderFailure('NONZERO_FREE_MODEL_COST', 502, false, 0, usage);
    if (typeof envelope.model !== 'string' || !envelope.model.endsWith(':free'))
      throw new ProviderFailure('UNVERIFIED_FREE_RESPONSE_MODEL', 502, false, 0, usage);
    if (envelope.error || choice?.finish_reason !== 'stop' || typeof choice.message?.content !== 'string')
      throw new ProviderFailure(choice?.finish_reason === 'length' ? 'PROVIDER_RESPONSE_TRUNCATED' : 'INCOMPLETE_PROVIDER_RESPONSE', 502, true, 0, usage);
    return { text: choice.message.content, model: envelope.model, usage };
  }
}
