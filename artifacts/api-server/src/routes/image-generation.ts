import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';
import { db, echoMediaTable } from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import { imageGenerationAvailability } from '../lib/imageGenerationProvider';
import { buildCharacterImagePrompt, imageStyleInstructions } from '../lib/imagePromptBuilder';
import { imageGenerationAccessStatus } from '../lib/imageGenerationAccess';
import { paidImageGenerationActivated } from '../lib/imageGenerationActivation';
import { generateCharacterImage } from '../lib/imageGenerationService';

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
      access: imageGenerationAccessStatus(req.userId),
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

router.get('/ai-engine/images/status', requireAuth, (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.json({ ...imageGenerationAvailability(), access: imageGenerationAccessStatus(req.userId) });
});

router.post('/ai-engine/images/generate', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!imageGenerationAccessStatus(req.userId).allowed) {
    res.status(403).json({ error: 'IMAGE_GENERATION_ACCOUNT_NOT_ALLOWED' });
    return;
  }
  // Hard stop until provider's real request/response and cost contract are
  // verified. An environment variable alone must not enable paid requests.
  if (!paidImageGenerationActivated()) {
    res.status(503).json({ error: 'IMAGE_GENERATION_DISABLED', generationEnabled: false });
    return;
  }
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
    const referencePaths = [...new Set(candidates.filter((v): v is string =>
      typeof v === 'string' && /^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(v)))].slice(0, 4);
    const preparedPrompt = buildCharacterImagePrompt({
      name: String(character.name ?? ''), scene: input.data.prompt, style: selected, identity,
    });
    const result = await generateCharacterImage({
      ownerId: req.userId!, universeId: input.data.universeId,
      characterId: character.id, preparedPrompt, style: selected, referencePaths,
    });
    res.json({ status: 'generated', objectPath: result.objectPath, billedUsd: result.billedUsd, jobId: result.jobId });
  } catch (error) {
    req.log.error({ err: error }, 'Image generation failed');
    res.status(503).json({ error: 'IMAGE_GENERATION_UNAVAILABLE' });
  }
});

export default router;
