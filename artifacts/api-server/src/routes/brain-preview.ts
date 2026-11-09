import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { PreviewCharacterDecisionBody, type CharacterDecisionInput, type SocialState } from "@workspace/api-zod";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { previewForOwner } from "../ai-engine/service";
import { GeminiDmProvider } from "../ai-engine/gemini";
import { EngineError, type TextProvider } from "../ai-engine/contracts";
import { VisionError, type VisionContext } from "../vision/contracts";
import { visionService } from "../vision/service";
import { MeteredTextProvider } from "../lib/metered-ai";

const provider = new GeminiDmProvider();

function warnRequest(req: Request, code: string, message: string): void {
  const log = (req as Request & {
    log?: { warn: (bindings: { code: string }, message: string) => void };
  }).log;
  log?.warn({ code }, message);
}

type BrainPreviewRouteOptions = {
  authenticate?: RequestHandler;
  read?: (ownerId: string, universeId?: string) => Promise<{ state: unknown; revision: number }>;
  providerForOwner?: (ownerId: string) => TextProvider;
  visionForOwner?: (ownerId: string, state: SocialState, input: CharacterDecisionInput) => Promise<VisionContext>;
};

/** Factory keeps production auth as the default while allowing isolated HTTP tests. */
export function createBrainPreviewRouter(options: BrainPreviewRouteOptions = {}): IRouter {
  const router: IRouter = Router();
  const gates = new Map<string, { running: boolean; until: number }>();

  router.post("/ai-engine/preview", options.authenticate ?? requireAuth, async (req, res): Promise<void> => {
    const input = PreviewCharacterDecisionBody.strict().safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "INVALID_PREVIEW_INPUT" }); return; }
    const owner = req.userId!;
    const now = Date.now();
    for (const [id, gate] of gates) if (!gate.running && gate.until <= now) gates.delete(id);
    const gate = gates.get(owner);
    if (gate?.running || (gate && gate.until > now)) {
      res.setHeader("Retry-After", "5");
      res.status(429).json({ error: "PREVIEW_BUSY_OR_COOLDOWN" });
      return;
    }
    gates.set(owner, { running: true, until: now + 5000 });
    try {
      const read = options.read ?? readUniverse;
      res.json(await previewForOwner(owner, input.data, {
        read: (ownerId, universeId) => read(ownerId, universeId ?? "primary"),
        provider: options.providerForOwner?.(owner) ?? new MeteredTextProvider(owner, "brain_text", provider),
        vision: options.visionForOwner ?? ((ownerId, state, decisionInput) =>
          visionService.ensureForDecision(ownerId, state, decisionInput)),
      }));
    } catch (error) {
      // Keep prompts, generated content and provider messages out of logs/responses.
      if (error instanceof VisionError) {
        warnRequest(req, error.code, "Vision context load failed");
        res.status(error.status).json({
          error: error.code,
          executed: false,
          attempts: error.attempts,
          contextAudit: null,
        });
        return;
      }
      const safe = error instanceof EngineError ? error : new EngineError("PREVIEW_FAILED", 502);
      warnRequest(req, safe.code, "Manual character preview failed");
      if (safe.retryAfterMs) res.setHeader("Retry-After", String(Math.ceil(safe.retryAfterMs / 1000)));
      res.status(safe.status).json({
        error: safe.code,
        executed: false,
        attempts: safe.attempts ?? [],
        contextAudit: safe.contextAudit ?? null,
      });
    } finally {
      gates.set(owner, { running: false, until: Date.now() + 5000 });
    }
  });

  return router;
}

export const brainPreviewRouter = createBrainPreviewRouter();
