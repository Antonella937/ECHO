import { EngineError, ProviderFailure, unknownUsage, type EngineAttempt, type TextProvider } from './contracts';
import { OpenRouterProvider } from './openrouter';

type FreeModel = { id: string; jsonMode: boolean; disableReasoning: boolean };
const preferred = ['google/gemma-4-31b-it:free', 'google/gemma-4-26b-a4b-it:free', 'nvidia/nemotron-3-ultra-550b-a55b:free'];
const invalidOutput = new Set(['INVALID_MODEL_JSON', 'INVALID_MODEL_DECISION', 'UNSAFE_OR_INCONSISTENT_DECISION']);
const zeroPrice = (value: unknown) => (typeof value === 'number' || (typeof value === 'string' && value.trim() !== '')) && Number(value) === 0;

/** Public catalog is checked before selection: suffix alone is not a price check. */
export async function discoverFreeModels(request: typeof fetch = fetch): Promise<FreeModel[]> {
  let data: unknown;
  try {
    const response = await request('https://openrouter.ai/api/v1/models', { signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error();
    data = await response.json();
  } catch { throw new EngineError('FREE_MODEL_CATALOG_UNAVAILABLE', 503); }
  const entries = data && typeof data === 'object' && 'data' in data && Array.isArray(data.data) ? data.data : [];
  const free: FreeModel[] = [];
  for (const item of entries) {
    if (!item || typeof item.id !== 'string' || !item.id.endsWith(':free') ||
      !item.pricing || !zeroPrice(item.pricing.prompt) || !zeroPrice(item.pricing.completion) ||
      (item.pricing.request != null && !zeroPrice(item.pricing.request)) ||
      !Array.isArray(item.architecture?.input_modalities) || !item.architecture.input_modalities.includes('text') ||
      !Array.isArray(item.architecture?.output_modalities) || !item.architecture.output_modalities.includes('text') ||
      /safety|moderation|code/i.test(item.id)) continue;
    const parameters: string[] = Array.isArray(item.supported_parameters) ? item.supported_parameters : [];
    free.push({ id: item.id, jsonMode: parameters.includes('response_format'), disableReasoning: parameters.includes('reasoning') });
  }
  free.sort((a, b) => {
    const ai = preferred.indexOf(a.id), bi = preferred.indexOf(b.id);
    return (ai < 0 ? 100 : ai) - (bi < 0 ? 100 : bi) || Number(b.jsonMode) - Number(a.jsonMode) || a.id.localeCompare(b.id);
  });
  if (!free.length) throw new EngineError('NO_FREE_MODELS_AVAILABLE', 503);
  return free;
}

/** At most 3 distinct free models / 75 seconds per explicit preview. No jobs.
 * Cooldowns contain no owner IDs or character data and prevent request storms.
 */
export class FreeModelProvider implements TextProvider {
  readonly name = 'openrouter';
  private catalog?: { models: FreeModel[]; until: number };
  private readonly cooldown = new Map<string, number>();
  constructor(private readonly dependencies: {
    discover?: () => Promise<FreeModel[]>;
    create?: (model: FreeModel, timeoutMs: number) => TextProvider;
    now?: () => number;
  } = {}) {}

  async complete(input: Parameters<TextProvider['complete']>[0]) {
    const now = this.dependencies.now ?? Date.now;
    const deadline = now() + 75000;
    if (!this.catalog || this.catalog.until <= now()) {
      this.catalog = { models: await (this.dependencies.discover ?? discoverFreeModels)(), until: now() + 300000 };
    }
    const models = this.catalog.models;
    const attempts: EngineAttempt[] = [];
    let sent = 0;
    for (const model of models) {
      if (sent >= 3 || now() >= deadline) break;
      if (!model.id.endsWith(':free')) throw new EngineError('FREE_MODEL_REQUIRED');
      if ((this.cooldown.get(model.id) ?? 0) > now()) {
        attempts.push({ model: model.id, outcome: 'skipped', code: 'MODEL_COOLDOWN', usage: unknownUsage() });
        continue;
      }
      sent++;
      let usage = unknownUsage();
      try {
        const provider = this.dependencies.create
          ? this.dependencies.create(model, Math.max(1, Math.min(25000, deadline - now())))
          : new OpenRouterProvider(model.id, fetch, { ...model, timeoutMs: Math.max(1, Math.min(25000, deadline - now())) });
        const completion = await provider.complete(input);
        usage = completion.usage ?? usage;
        if (!models.some(m => m.id === completion.model)) throw new ProviderFailure('UNVERIFIED_FREE_RESPONSE_MODEL', 502, false, 0, usage);
        input.validate?.(completion.text);
        attempts.push({ model: model.id, outcome: 'success', code: null, usage });
        return { ...completion, attempts };
      } catch (error) {
        if (error instanceof ProviderFailure) usage = error.usage;
        const safe = error instanceof EngineError ? error : new EngineError('PROVIDER_FAILED', 502);
        attempts.push({ model: model.id, outcome: 'failure', code: safe.code, usage,
          ...(safe.diagnostic ? { diagnostic: safe.diagnostic } : {}) });
        const retryable = error instanceof ProviderFailure ? error.retryable : invalidOutput.has(safe.code);
        if (!retryable) { safe.attempts = attempts; throw safe; }
        this.cooldown.set(model.id, now() + (error instanceof ProviderFailure && error.retryAfterMs ? error.retryAfterMs : 30000));
      }
    }
    const retryTimes = models.map(m => (this.cooldown.get(m.id) ?? 0) - now()).filter(ms => ms > 0);
    const failure = new EngineError('FREE_MODELS_EXHAUSTED_OR_COOLDOWN',
      attempts.length > 0 && attempts.every(a => a.code === 'OPENROUTER_RATE_LIMITED' || a.code === 'MODEL_COOLDOWN') ? 429 : 503);
    if (retryTimes.length) failure.retryAfterMs = Math.min(...retryTimes);
    failure.attempts = attempts;
    throw failure;
  }
}
