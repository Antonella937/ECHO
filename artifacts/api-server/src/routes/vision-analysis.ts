import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { SaveUniverseBody, type SocialState } from "@workspace/api-zod";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { readUniverse } from "../lib/universeRepository";
import { VisionError } from "../vision/contracts";
import { visionService } from "../vision/service";

const VisionAnalyzeBody = z.object({
  postId: z.string().trim().min(1).max(120).optional(),
  storyId: z.string().trim().min(1).max(120).optional(),
  universeId: z.string().trim().min(1).max(120).optional(),
}).strict().refine(value => Boolean(value.postId) !== Boolean(value.storyId));

type VisionAnalysisRouteOptions = {
  authenticate?: RequestHandler;
  read?: (ownerId: string, universeId: string) => Promise<{ state: unknown; revision: number }>;
  analyzePost?: (ownerId: string, state: SocialState, postId: string, universeId: string) => Promise<Record<string, unknown>>;
  analyzeStory?: (ownerId: string, state: SocialState, storyId: string, universeId: string) => Promise<Record<string, unknown>>;
};

function warnRequest(req: Request, code: string, message: string): void {
  const log = (req as Request & {
    log?: { warn: (bindings: { code: string }, message: string) => void };
  }).log;
  log?.warn({ code }, message);
}

/** Production defaults keep Clerk auth and the real owner-scoped Vision service. */
export function createVisionAnalysisRouter(options: VisionAnalysisRouteOptions = {}): IRouter {
  const router: IRouter = Router();
  const running = new Set<string>();
  const read = options.read ?? readUniverse;
  const analyzePost = options.analyzePost ?? ((ownerId, state, postId, universeId) =>
    visionService.analyzePost(ownerId, state, postId, universeId));
  const analyzeStory = options.analyzeStory ?? ((ownerId, state, storyId, universeId) =>
    visionService.analyzeStory(ownerId, state, storyId, universeId));

  router.post("/ai-engine/vision/analyze", options.authenticate ?? requireAuth, async (req, res): Promise<void> => {
    const input = VisionAnalyzeBody.safeParse(req.body);
    if (!input.success) { res.status(400).json({ error: "INVALID_VISION_INPUT" }); return; }

    const owner = req.userId!;
    const universeId = input.data.universeId ?? "primary";
    const lockKey = JSON.stringify([owner, universeId]);
    if (running.has(lockKey)) {
      res.setHeader("Retry-After", "3");
      res.status(429).json({ error: "VISION_UNIVERSE_REQUEST_IN_PROGRESS" });
      return;
    }

    running.add(lockKey);
    try {
      const snapshot = await read(owner, universeId);
      if (!snapshot.state) { res.status(404).json({ error: "UNIVERSE_NOT_FOUND" }); return; }
      const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
      if (!stored.success) { res.status(422).json({ error: "INVALID_STORED_UNIVERSE" }); return; }
      const result = input.data.postId
        ? await analyzePost(owner, stored.data.state, input.data.postId, universeId)
        : await analyzeStory(owner, stored.data.state, input.data.storyId!, universeId);
      res.json({
        ...result,
        summary: result && typeof result === "object" && "summary" in result ? result.summary : null,
        skippedVideoCount: result && typeof result === "object" && "skippedVideoCount" in result
          ? result.skippedVideoCount
          : 0,
      });
    } catch (error) {
      if (error instanceof VisionError) {
        warnRequest(req, error.code, "Vision analysis failed");
        res.status(error.status).json({ error: error.code, attempts: error.attempts });
        return;
      }
      warnRequest(req, "VISION_ANALYSIS_FAILED", "Vision analysis failed");
      res.status(502).json({ error: "VISION_ANALYSIS_FAILED", attempts: [] });
    } finally {
      running.delete(lockKey);
    }
  });

  return router;
}

export const visionAnalysisRouter = createVisionAnalysisRouter();
