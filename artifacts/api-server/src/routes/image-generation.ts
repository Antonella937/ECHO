import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';
import { db, echoMediaTable } from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import { imageGenerationAvailability } from '../lib/imageGenerationProvider';
import { buildCharacterImagePrompt, imageStyleInstructions } from '../lib/imagePromptBuilder';

/**
 * Image generation preparation. Strictly NO provider calls, no paid operations.
 * The active character and its identity come from the owner's persisted universe,
 * never from untrusted client-supplied reference URLs or descriptions.
 */
const Input = z.object({
  universeId: z.string().min(1).max(120).default('primary'),
  characterId: z.string().min(1).max(120),
  prompt: z.string().trim().min(3).max(2000),
}).strict();
const router: IRouter = Router();

router.post('/ai-engine/images/prepare', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const input = Input.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'INVALID_IMAGE_REQUEST' }); return; }
  try {
    const { state } = await readUniverse(req.userId!, input.data.universeId);
    if (!state) { res.status(404).json({ error: 'UNIVERSE_NOT_FOUND' }); return; }
    const characters = Array.isArray(state.characters) ? state.characters : [];
    const character = characters.find((c: any) => c?.id === input.data.characterId && !c.archived) as any;
    if (!character || state.currentCharacterId !== character.id) {
      res.status(403).json({ error: 'ACTIVE_CHARACTER_REQUIRED' }); return;
    }
    const identity = character.identity ?? {};
    const selected = typeof state.imageStyle === 'string' && state.imageStyle in imageStyleInstructions
      ? state.imageStyle as keyof typeof imageStyleInstructions : 'natural';
    const candidates = [character.avatar, ...(Array.isArray(identity.referenceImages) ? identity.referenceImages : [])];
    const references = [...new Set(candidates.filter((v): v is string =>
      typeof v === 'string' && /^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(v)))].slice(0, 4);
    // Only count reference objects registered to the authenticated owner.
    // Actual bytes will be fetched server-side when paid generation is enabled.
    const owned = references.length ? await db.select({ objectPath: echoMediaTable.objectPath })
      .from(echoMediaTable).where(and(
        eq(echoMediaTable.ownerId, req.userId!),
        inArray(echoMediaTable.objectPath, references),
      )) : [];
    const verifiedReferenceCount = owned.length;
    const preparedPrompt = buildCharacterImagePrompt({
      name: String(character.name ?? ''), scene: input.data.prompt, style: selected, identity,
    });
    res.json({
      status: 'preview_only',
      generationEnabled: false,
      paidCallsMade: 0,
      provider: imageGenerationAvailability(),
      characterId: character.id,
      characterName: character.name,
      style: selected,
      referenceCount: verifiedReferenceCount,
      ignoredUnverifiedReferences: references.length - verifiedReferenceCount,
      hasFacialDescription: Boolean(identity.facialDescription),
      hasBodyDescription: Boolean(identity.bodyDescription),
      preparedPrompt,
      note: 'No provider request was made. Private reference files remain on ECHO.',
    });
  } catch (error) {
    req.log.error({ err: error }, 'Image preparation failed');
    res.status(503).json({ error: 'IMAGE_PREPARATION_UNAVAILABLE' });
  }
});

router.get('/ai-engine/images/status', requireAuth, (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json(imageGenerationAvailability());
});

router.post('/ai-engine/images/generate', requireAuth, (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(503).json({ error: 'IMAGE_GENERATION_DISABLED', generationEnabled: false, paidCallsMade: 0 });
});

export default router;
