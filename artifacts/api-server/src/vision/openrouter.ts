import { VisionAnalysisSchema, VisionError, type VisionAnalysis, type VisionAttempt, type VisionProvider, type VisionUsage } from "./contracts";

interface CatalogModel {
  id: string;
  name?: string;
  architecture?: { input_modalities?: string[]; output_modalities?: string[] };
  pricing?: { prompt?: string; completion?: string; request?: string };
  supported_parameters?: string[];
}

export interface FreeVisionModel {
  id: string;
  jsonMode: boolean;
}

interface ProviderResult {
  text: string;
  model: string;
  usage: VisionUsage;
}

const OPENROUTER_MODELS_URL = "https://openrouter.ai/api/v1/models";
const OPENROUTER_CHAT_URL = "https://openrouter.ai/api/v1/chat/completions";
const TOTAL_BUDGET_MS = 75_000;
const MAX_MODELS = 3;
const MODEL_COOLDOWN = new Map<string, number>();

const emptyUsage = (): VisionUsage => ({ promptTokens: null, completionTokens: null, cost: null });
const safeNumber = (value: unknown): number | null =>
  typeof value === "number" && Number.isFinite(value) && value >= 0 ? value : null;

function usageFrom(body: unknown): VisionUsage {
  if (!body || typeof body !== "object" || !("usage" in body) || !body.usage || typeof body.usage !== "object") return emptyUsage();
  const usage = body.usage as Record<string, unknown>;
  return {
    promptTokens: safeNumber(usage.prompt_tokens),
    completionTokens: safeNumber(usage.completion_tokens),
    cost: safeNumber(usage.cost),
  };
}

function freeZeroCostModel(item: CatalogModel): boolean {
  const p = item.pricing;
  return item.id.endsWith(":free") &&
    item.architecture?.input_modalities?.includes("image") === true &&
    item.architecture?.input_modalities?.includes("text") === true &&
    item.architecture?.output_modalities?.includes("text") === true &&
    p?.prompt === "0" && p?.completion === "0" &&
    (p.request === undefined || p.request === null || p.request === "0");
}

/** Discovers image-capable models live and admits only explicitly free catalog entries. */
export async function discoverFreeVisionModels(request: typeof fetch = fetch): Promise<FreeVisionModel[]> {
  let response: Response;
  try {
    response = await request(OPENROUTER_MODELS_URL, { signal: AbortSignal.timeout(10_000) });
  } catch {
    throw new VisionError("VISION_MODEL_CATALOG_UNAVAILABLE", 503);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new VisionError("VISION_MODEL_CATALOG_UNAVAILABLE", 503);
  }
  const body: unknown = await response.json().catch(() => null);
  const data = body && typeof body === "object" && "data" in body ? body.data : null;
  if (!Array.isArray(data)) throw new VisionError("VISION_MODEL_CATALOG_INVALID", 503);

  const models = data.filter((entry): entry is CatalogModel =>
    Boolean(entry && typeof entry === "object" && "id" in entry && typeof entry.id === "string" &&
      !/safety|moderation/i.test(entry.id) && freeZeroCostModel(entry as CatalogModel))
  );
  // Prefer general image understanding over specialized safety models; all IDs are catalog-discovered.
  const preferred = ["google/gemma-4-31b-it:free", "nvidia/nemotron-3.5-super-vl:free", "google/gemma-4-26b-a4b-it:free"];
  models.sort((a, b) => {
    const ai = preferred.indexOf(a.id), bi = preferred.indexOf(b.id);
    return (ai < 0 ? Number.MAX_SAFE_INTEGER : ai) - (bi < 0 ? Number.MAX_SAFE_INTEGER : bi) || a.id.localeCompare(b.id);
  });
  const result = models.slice(0, MAX_MODELS).map((model) => ({
    id: model.id,
    jsonMode: model.supported_parameters?.includes("response_format") === true,
  }));
  if (!result.length) throw new VisionError("NO_FREE_VISION_MODEL_AVAILABLE", 503);
  return result;
}

function extractText(body: unknown): { text: string; model: string; usage: VisionUsage; error: string | null } {
  const usage = usageFrom(body);
  if (!body || typeof body !== "object") return { text: "", model: "", usage, error: "INVALID_PROVIDER_RESPONSE" };
  const response = body as {
    model?: unknown; error?: unknown;
    choices?: Array<{ finish_reason?: unknown; message?: { content?: unknown } }>;
  };
  const choice = response.choices?.[0];
  if (typeof response.model !== "string" || !response.model.endsWith(":free"))
    return { text: "", model: typeof response.model === "string" ? response.model : "", usage, error: "UNVERIFIED_FREE_RESPONSE_MODEL" };
  if (usage.cost !== null && usage.cost > 0) return { text: "", model: response.model, usage, error: "NONZERO_FREE_MODEL_COST" };
  if (response.error || choice?.finish_reason !== "stop" || typeof choice.message?.content !== "string")
    return { text: "", model: response.model, usage, error: choice?.finish_reason === "length" ? "VISION_RESPONSE_TRUNCATED" : "INCOMPLETE_PROVIDER_RESPONSE" };
  return { text: choice.message.content, model: response.model, usage, error: null };
}

function parseAnalysis(text: string): VisionAnalysis {
  const normalized = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  let value: unknown;
  try { value = JSON.parse(normalized); } catch { throw new VisionError("INVALID_VISION_JSON"); }
  const parsed = VisionAnalysisSchema.safeParse(value);
  if (!parsed.success) throw new VisionError("INVALID_VISION_STRUCTURE");
  const serialized = JSON.stringify(parsed.data);
  if (/(?:sk-[a-z0-9_-]{12,}|Bearer\s+[a-z0-9._-]{12,})/i.test(serialized))
    throw new VisionError("SENSITIVE_OUTPUT_REJECTED");
  return parsed.data;
}

async function requestModel(
  model: FreeVisionModel,
  image: { mimeType: string; base64: string },
  prompt: string,
  request: typeof fetch,
): Promise<ProviderResult> {
  const key = process.env.OPENROUTER_API_KEY;
  if (!key) throw new VisionError("OPENROUTER_NOT_CONFIGURED", 503);
  let response: Response;
  try {
    response = await request(OPENROUTER_CHAT_URL, {
      method: "POST",
      signal: AbortSignal.timeout(25_000),
      headers: { Authorization: `Bearer ${key}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        model: model.id,
        stream: false,
        max_tokens: 2200,
        ...(model.jsonMode ? { response_format: { type: "json_object" } } : {}),
        messages: [
          {
            role: "system",
            content: "Describe only visible, non-sensitive image content. Never identify a person or infer age, gender, race, ethnicity, health, religion, politics, sexuality, or other sensitive traits. Return exactly one JSON object matching the requested schema. Use uncertainty rather than guessing.",
          },
          {
            role: "user",
            content: [
              { type: "text", text: prompt },
              { type: "image_url", image_url: { url: `data:${image.mimeType};base64,${image.base64}` } },
            ],
          },
        ],
      }),
    });
  } catch {
    throw new VisionError("OPENROUTER_CONNECTION_FAILED", 502);
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new VisionError(response.status === 429 ? "OPENROUTER_RATE_LIMITED" : `OPENROUTER_REJECTED_HTTP_${response.status}`,
      response.status === 429 ? 429 : 502);
  }
  const body: unknown = await response.json().catch(() => null);
  const result = extractText(body);
  if (result.error) throw new VisionError(result.error, 502, [], result.usage);
  return { text: result.text, model: result.model, usage: result.usage };
}

/** One image, bounded free-only model fallback; no generic or paid routing. */
export class OpenRouterVisionProvider implements VisionProvider {
  readonly name = "openrouter";
  constructor(private readonly request: typeof fetch = fetch) {}

  async analyze(input: Parameters<VisionProvider["analyze"]>[0]) {
    const key = process.env.OPENROUTER_API_KEY;
    if (!key) throw new VisionError("OPENROUTER_NOT_CONFIGURED", 503);
    const models = await discoverFreeVisionModels(this.request);
    const started = Date.now();
    const attempts: VisionAttempt[] = [];
    let lastError: VisionError | null = null;
    for (const model of models) {
      if (Date.now() - started >= TOTAL_BUDGET_MS) break;
      const cooldownUntil = MODEL_COOLDOWN.get(model.id) ?? 0;
      if (cooldownUntil > Date.now()) {
        attempts.push({ model: model.id, outcome: "rejected", errorCode: "MODEL_COOLDOWN", usage: emptyUsage() });
        continue;
      }
      let response: ProviderResult | undefined;
      try {
        response = await requestModel(model, input.image, input.prompt, this.request);
        if (!models.some(candidate => candidate.id === response!.model))
          throw new VisionError("UNVERIFIED_FREE_RESPONSE_MODEL", 502, [], response.usage);
        if (response.usage.cost !== null && response.usage.cost > 0)
          throw new VisionError("NONZERO_FREE_MODEL_COST", 502, [], response.usage);
        const analysis = input.validate(response.text);
        attempts.push({ model: response.model, outcome: "accepted", errorCode: null, usage: response.usage });
        return { analysis, provider: this.name, model: response.model, usage: response.usage, attempts };
      } catch (error) {
        const source = error instanceof VisionError ? error : new VisionError("VISION_PROVIDER_FAILED");
        const visionError = source.usage || !response ? source
          : new VisionError(source.code, source.status, source.attempts, response.usage);
        lastError = visionError;
        if (visionError.code === "OPENROUTER_RATE_LIMITED") MODEL_COOLDOWN.set(model.id, Date.now() + 30_000);
        attempts.push({ model: model.id, outcome: "rejected", errorCode: visionError.code, usage: visionError.usage ?? emptyUsage() });
      }
    }
    throw new VisionError(lastError?.code ?? "FREE_VISION_MODELS_EXHAUSTED", lastError?.status ?? 503, attempts);
  }
}

export function parseVisionResult(text: string): VisionAnalysis {
  return parseAnalysis(text);
}
