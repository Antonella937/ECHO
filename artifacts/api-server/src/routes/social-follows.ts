import { Router, type IRouter, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import {
  followCharacter,
  listOwnFollowRequests,
  transitionFollowRequest,
  unfollowCharacter,
} from "../lib/characterFollows";

const followInputSchema = z.object({
  sourceUniverseId: z.string().trim().min(1).max(120),
  sourceCharacterId: z.string().trim().min(1).max(120),
  // This identifies the destination only. It never supplies the authenticated
  // source owner or authorizes accepting/rejecting/cancelling a request.
  targetOwnerId: z.string().trim().min(1).max(255),
  targetUniverseId: z.string().trim().min(1).max(120),
  targetCharacterId: z.string().trim().min(1).max(120),
}).strict();

const requestListQuerySchema = z.object({
  universeId: z.string().trim().min(1).max(120).default("primary"),
  direction: z.enum(["incoming", "outgoing", "all"]).default("all"),
  status: z.enum(["pending", "accepted", "rejected", "cancelled", "all"]).default("pending"),
}).strict();

const transitionQuerySchema = z.object({
  universeId: z.string().trim().min(1).max(120).default("primary"),
}).strict();

const requestIdSchema = z.string().uuid();

type SocialFollowsRouterOptions = {
  authenticate?: RequestHandler;
};

function sendServiceError(res: Parameters<RequestHandler>[1], error: string): void {
  if (error === "SELF_FOLLOW_NOT_ALLOWED") {
    res.status(400).json({ error });
  } else if (error === "FOLLOW_STATE_CONFLICT") {
    res.status(409).json({ error });
  } else {
    // Missing and non-participant request IDs intentionally share one response.
    res.status(404).json({ error: "CHARACTER_OR_REQUEST_NOT_FOUND" });
  }
}

/** Cross-owner follow state lives in relational tables; legacy universe follows stay untouched. */
export function createSocialFollowsRouter(options: SocialFollowsRouterOptions = {}): IRouter {
  const router: IRouter = Router();
  const authenticate = options.authenticate ?? requireAuth;
  router.use("/social", (_req, res, next) => {
    res.setHeader("Cache-Control", "private, no-store");
    res.vary("Authorization");
    res.vary("Cookie");
    next();
  });

  router.get("/social/follow-requests", authenticate, async (req, res): Promise<void> => {
    const parsed = requestListQuerySchema.safeParse(req.query);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_REQUEST_FILTER" });
      return;
    }
    const requests = await listOwnFollowRequests(
      req.userId!,
      parsed.data.universeId,
      parsed.data.direction,
      parsed.data.status,
    );
    res.json({ requests });
  });

  router.post("/social/follows", authenticate, async (req, res): Promise<void> => {
    const parsed = followInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_FOLLOW_INPUT" });
      return;
    }
    const result = await followCharacter(req.userId!, parsed.data);
    if (!result.ok) {
      sendServiceError(res, result.error);
      return;
    }
    res.json(result.value);
  });

  router.delete("/social/follows", authenticate, async (req, res): Promise<void> => {
    const parsed = followInputSchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_FOLLOW_INPUT" });
      return;
    }
    const result = await unfollowCharacter(req.userId!, parsed.data);
    if (!result.ok) {
      sendServiceError(res, result.error);
      return;
    }
    res.json(result.value);
  });

  const registerTransition = (
    action: "accept" | "reject" | "cancel",
  ) => {
    router.post(`/social/follow-requests/:requestId/${action}`, authenticate, async (req, res): Promise<void> => {
      const parsed = requestIdSchema.safeParse(req.params.requestId);
      if (!parsed.success) {
        res.status(400).json({ error: "INVALID_REQUEST_ID" });
        return;
      }
      const parsedQuery = transitionQuerySchema.safeParse(req.query);
      if (!parsedQuery.success) {
        res.status(400).json({ error: "INVALID_REQUEST_UNIVERSE" });
        return;
      }
      const result = await transitionFollowRequest(
        req.userId!,
        parsed.data,
        action,
        parsedQuery.data.universeId,
      );
      if (!result.ok) {
        sendServiceError(res, result.error);
        return;
      }
      res.json(result.value);
    });
  };

  registerTransition("accept");
  registerTransition("reject");
  registerTransition("cancel");
  return router;
}

export const socialFollowsRouter = createSocialFollowsRouter();
