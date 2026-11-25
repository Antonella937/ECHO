import { setTimeout as pause } from "node:timers/promises";
import { VisionError, type VisionAttempt, type VisionProvider } from "./contracts";

import { CloudflareVisionProvider } from "./cloudflare";

const model = "florence-2-base-ft-q4";
const usage = { promptTokens: null, completionTokens: null, cost: null };

export class FallbackVisionProvider implements VisionProvider {
  readonly name = "echo-vision";

  constructor(
    private readonly primary: VisionProvider,
    private readonly request: typeof fetch = fetch,
  ) {}

  async analyze(input: Parameters<VisionProvider["analyze"]>[0]) {
    try {
      return await this.primary.analyze(input);
    } catch (error) {
      if (!(error instanceof VisionError)) throw error;
      const attempts = [...error.attempts];
      const accountId = process.env.CLOUDFLARE_WORKERS_AI_ACCOUNT_ID ?? process.env.CLOUDFLARE_R2_ACCOUNT_ID;
      const cloudflareToken = process.env.CLOUDFLARE_WORKERS_AI_TOKEN;
      if (accountId && cloudflareToken) {
        try {
          const result = await new CloudflareVisionProvider(accountId, cloudflareToken, this.request).analyze(input);
          return { ...result, attempts: [...attempts, ...result.attempts] };
        } catch (cloudflareError) {
          const code = cloudflareError instanceof VisionError ? cloudflareError.code : "CLOUDFLARE_VISION_FAILED";
          attempts.push({ model: "@cf/google/gemma-4-26b-a4b-it", outcome: "rejected", errorCode: code, usage });
          if (!process.env.ECHO_VISION_WORKER_URL || !process.env.ECHO_VISION_WORKER_TOKEN)
            throw new VisionError(code, 503, attempts);
        }
      }

      const url = process.env.ECHO_VISION_WORKER_URL;
      const token = process.env.ECHO_VISION_WORKER_TOKEN;
      if (!url || !token) throw error;

      const retryDelays = [0, 2_000, 4_000];
      const endpoint = new URL("/caption", url);
      const body = Buffer.from(input.image.base64, "base64");
      for (const delay of retryDelays) {
        if (delay) await pause(delay);
        try {
          const response = await this.request(endpoint, {
            method: "POST",
            redirect: "error",
            signal: AbortSignal.timeout(30_000),
            headers: {
              authorization: `Bearer ${token}`,
              "content-type": input.image.mimeType,
            },
            body,
          });
          if (!response.ok) throw new VisionError(
            "ECHO_VISION_WORKER_UNAVAILABLE", response.status,
          );
          const data: unknown = await response.json();
          const caption = data && typeof data === "object" && "caption" in data ? data.caption : null;
          if (typeof caption !== "string") throw new VisionError("ECHO_VISION_INVALID_CAPTION");

          const analysis = input.validate(JSON.stringify({
            sceneDescription: caption,
            setting: "",
            objects: [],
            people: { count: 0, nonIdentifyingDetails: [] },
            activities: [],
            dominantColors: [],
            visibleText: [],
            notableDetails: [],
            uncertainty: ["Only the scene description was analyzed by the fallback model."],
          }));
          return {
            analysis,
            provider: this.name,
            model,
            usage,
            attempts: [...attempts, { model, outcome: "accepted" as const, errorCode: null, usage }],
          };
        } catch (fallbackError) {
          const code = fallbackError instanceof VisionError ? fallbackError.code : "ECHO_VISION_WORKER_UNAVAILABLE";
          const attempt: VisionAttempt = { model, outcome: "rejected", errorCode: code, usage };
          attempts.push(attempt);
          // Retry a busy or rate-limited worker before any message is delivered.
          // Timeouts may still have work in flight, so they are not retried here.
          const retryable = fallbackError instanceof VisionError &&
            code === "ECHO_VISION_WORKER_UNAVAILABLE" && [429, 503].includes(fallbackError.status);
          if (!retryable || delay === retryDelays.at(-1)) throw new VisionError(code, 503, attempts);
        }
      }
      throw new VisionError("ECHO_VISION_WORKER_UNAVAILABLE", 503, attempts);
    }
  }
}
