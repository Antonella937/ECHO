import type { TextProvider } from "../ai-engine/contracts";
import { EngineError } from "../ai-engine/contracts";
import type { VisionProvider } from "../vision/contracts";
import { AiBudgetExceededError, reserveAiUsage, settleAiUsage, type UsageReservation } from "./ai-usage";

type MeterCategory = "autonomy" | "brain_text" | "memory_context" | "vision" | "images";

function providerDetails(value: unknown) {
  const item = value as {
    attempts?: unknown;
    usage?: { promptTokens?: unknown; completionTokens?: unknown; cost?: unknown };
    model?: unknown;
    code?: unknown;
  } | null;
  const attempts = Array.isArray(item?.attempts) ? item.attempts : [];
  const last = attempts.at(-1) as { model?: unknown; usage?: { promptTokens?: unknown; completionTokens?: unknown; cost?: unknown } } | undefined;
  const usage = item?.usage ?? last?.usage;
  return {
    attempted: attempts.length > 0 || typeof item?.model === "string",
    attemptCount: attempts.length,
    model: typeof item?.model === "string" ? item.model : typeof last?.model === "string" ? last.model : null,
    promptTokens: typeof usage?.promptTokens === "number" ? usage.promptTokens : null,
    completionTokens: typeof usage?.completionTokens === "number" ? usage.completionTokens : null,
    reportedCost: typeof usage?.cost === "number" ? usage.cost : null,
    errorCode: typeof item?.code === "string" ? item.code : "AI_PROVIDER_FAILED",
  };
}

async function reserve(ownerId: string, category: MeterCategory, operation: string): Promise<UsageReservation> {
  try { return await reserveAiUsage(ownerId, category, operation); }
  catch (error) {
    if (error instanceof AiBudgetExceededError) throw new EngineError(error.code, 429);
    throw error;
  }
}

export class MeteredTextProvider implements TextProvider {
  readonly name: string;
  constructor(private readonly ownerId: string, private readonly category: "autonomy" | "brain_text" | "memory_context", private readonly inner: TextProvider) {
    this.name = inner.name;
  }
  async complete(input: Parameters<TextProvider["complete"]>[0]): ReturnType<TextProvider["complete"]> {
    const reservation = await reserve(this.ownerId, this.category, "text_generation");
    try {
      const result = await this.inner.complete(input);
      const details = providerDetails(result);
      await settleAiUsage(reservation, {
        ...details, succeeded: true, provider: details.model?.includes("/") || details.model?.endsWith(":free") ? "openrouter" : this.inner.name,
      });
      return result;
    } catch (error) {
      const details = providerDetails(error);
      await settleAiUsage(reservation, { ...details, succeeded: false });
      throw error;
    }
  }
}

export async function withMeteredVision(
  ownerId: string,
  input: Parameters<VisionProvider["analyze"]>[0],
  provider: VisionProvider,
): Promise<Awaited<ReturnType<VisionProvider["analyze"]>>> {
  const reservation = await reserve(ownerId, "vision", "vision_image_analysis");
  try {
    const result = await provider.analyze(input);
    await settleAiUsage(reservation, {
      attempted: true, succeeded: true, attemptCount: result.attempts.length,
      promptTokens: result.usage.promptTokens, completionTokens: result.usage.completionTokens,
      reportedCost: result.usage.cost, provider: result.provider, model: result.model,
    });
    return result;
  } catch (error) {
    const details = providerDetails(error);
    await settleAiUsage(reservation, { ...details, succeeded: false });
    throw error;
  }
}
