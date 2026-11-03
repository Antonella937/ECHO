import { Router, type IRouter, type Request, type RequestHandler } from "express";
import { z } from "zod";
import { requireAuth } from "../middlewares/requireAuth";
import { getCharacterVisibility, setCharacterVisibility } from "../lib/characterPrivacy";

const characterIdSchema = z.string().trim().min(1).max(120);
const visibilityBodySchema = z.object({
  visibility: z.enum(["public", "private"]),
}).strict();

type CharacterPrivacyRouterOptions = {
  authenticate?: RequestHandler;
};

function parseUniverseId(req: Request, res: Parameters<RequestHandler>[1]): string | null {
  const raw = req.query.universeId;
  if (raw === undefined) return "primary";
  if (typeof raw !== "string") {
    res.status(400).json({ error: "INVALID_UNIVERSE_ID" });
    return null;
  }
  const parsed = z.string().trim().min(1).max(120).safeParse(raw);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_UNIVERSE_ID" });
    return null;
  }
  return parsed.data;
}

function parseCharacterId(req: Request, res: Parameters<RequestHandler>[1]): string | null {
  const parsed = characterIdSchema.safeParse(req.params.characterId);
  if (!parsed.success) {
    res.status(400).json({ error: "INVALID_CHARACTER_ID" });
    return null;
  }
  return parsed.data;
}

/** Production uses Clerk auth; tests may inject an isolated synthetic owner. */
export function createCharacterPrivacyRouter(
  options: CharacterPrivacyRouterOptions = {},
): IRouter {
  const router: IRouter = Router();
  const authenticate = options.authenticate ?? requireAuth;

  router.get("/character-privacy/:characterId/visibility", authenticate, async (req, res): Promise<void> => {
    const universeId = parseUniverseId(req, res);
    const characterId = parseCharacterId(req, res);
    if (!universeId || !characterId) return;
    const visibility = await getCharacterVisibility(req.userId!, universeId, characterId);
    if (!visibility) {
      res.status(404).json({ error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ universeId, characterId, visibility });
  });

  router.put("/character-privacy/:characterId/visibility", authenticate, async (req, res): Promise<void> => {
    const universeId = parseUniverseId(req, res);
    const characterId = parseCharacterId(req, res);
    if (!universeId || !characterId) return;
    const parsed = visibilityBodySchema.safeParse(req.body);
    if (!parsed.success) {
      res.status(400).json({ error: "INVALID_VISIBILITY" });
      return;
    }
    const visibility = await setCharacterVisibility(
      req.userId!,
      universeId,
      characterId,
      parsed.data.visibility,
    );
    if (!visibility) {
      res.status(404).json({ error: "CHARACTER_NOT_FOUND" });
      return;
    }
    res.json({ universeId, characterId, visibility });
  });

  return router;
}

export const characterPrivacyRouter = createCharacterPrivacyRouter();
