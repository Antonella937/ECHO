import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { spendCredits, refundCredits } from '../lib/creditWallet';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';
import { db, echoMediaTable } from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import { imageGenerationAvailability } from '../lib/imageGenerationProvider';
import { buildCharacterImagePrompt, imageStyleInstructions } from '../lib/imagePromptBuilder';
import { prepareImageScene } from '../lib/imageScenePreparation';
import { imageGenerationAccessStatus } from '../lib/imageGenerationAccess';
import { paidImageGenerationActivated } from '../lib/imageGenerationActivation';
import { generateCharacterImage } from '../lib/imageGenerationService';
import { readImageBudgetReadiness } from '../lib/imageBudgetReadiness';

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
const GenerateInput = Input.extend({
  imageTransferAcknowledgement: z.literal('image-transfer-preview-v1'),
  sourceObjectPath: z.string().regex(/^\/objects\/uploads\/[0-9a-f-]{36}$/i).optional(),
});

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
    const scene = prepareImageScene(input.data.prompt, character, characters, selected);
    const references = scene.referencePaths;
    // Only count reference objects registered to the authenticated owner.
    // Actual bytes will be fetched server-side when paid generation is enabled.
    const owned = references.length ? await db.select({ objectPath: echoMediaTable.objectPath })
      .from(echoMediaTable).where(and(
        eq(echoMediaTable.ownerId, req.userId!),
        inArray(echoMediaTable.objectPath, references),
      )) : [];
    const verifiedReferenceCount = owned.length;
    const preparedPrompt = scene.preparedPrompt;
    res.json({
      status: 'preview_only',
      generationEnabled: false,
      paidCallsMade: 0,
      provider: imageGenerationAvailability(),
      access: imageGenerationAccessStatus(req.userId),
      characterId: character.id,
      characterName: character.name,
      recognizedCharacters: scene.people,
      referenceAssignments: scene.referenceAssignments,
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

const EditPreviewInput = Input.extend({
  sourceObjectPath: z.string().min(20).max(100).refine(value => value.startsWith('/objects/uploads/')),
});
router.post('/ai-engine/images/prepare-edit', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const input = EditPreviewInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'INVALID_IMAGE_EDIT_REQUEST' }); return; }
  try {
    const { state } = await readUniverse(req.userId!, input.data.universeId);
    if (!state) { res.status(404).json({ error: 'UNIVERSE_NOT_FOUND' }); return; }
    const character = (Array.isArray(state.characters) ? state.characters : []).find((item: any) => item?.id === input.data.characterId && !item.archived);
    if (!character || state.currentCharacterId !== character.id) { res.status(403).json({ error: 'ACTIVE_CHARACTER_REQUIRED' }); return; }
    const owned = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable)
      .where(and(eq(echoMediaTable.ownerId, req.userId!), eq(echoMediaTable.objectPath, input.data.sourceObjectPath))).limit(1);
    if (!owned.length) { res.status(403).json({ error: 'IMAGE_EDIT_SOURCE_NOT_OWNED' }); return; }
    const style = typeof state.imageStyle === 'string' && state.imageStyle in imageStyleInstructions
      ? state.imageStyle as keyof typeof imageStyleInstructions : 'natural';
    const preparedPrompt = buildCharacterImagePrompt({
      name: String(character.name ?? ''), scene: input.data.prompt, style, identity: character.identity ?? {},
    });
    res.json({ status: 'preview_only', generationEnabled: false, paidCallsMade: 0,
      sourceObjectPath: input.data.sourceObjectPath, preparedPrompt, style,
      note: 'Edit preview only. No provider call or private image transfer.' });
  } catch (error) {
    req.log.error({ err: error }, 'Image edit preview failed');
    res.status(503).json({ error: 'IMAGE_EDIT_PREPARATION_UNAVAILABLE' });
  }
});

router.get('/ai-engine/images/status', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const access = imageGenerationAccessStatus(req.userId);
  const availability = imageGenerationAvailability();
  try {
    const budget = await readImageBudgetReadiness();
    // Conservative public readiness: provider contract and production
    // activation still require explicit owner validation and approval.
    res.json({
      ...availability,
      enabled: access.allowed && paidImageGenerationActivated() && budget.canReserveOneImage && availability.prerequisites.openRouterKeyConfigured && availability.prerequisites.privateStorageConfigured,
      reason: access.allowed && paidImageGenerationActivated() && budget.canReserveOneImage && availability.prerequisites.openRouterKeyConfigured && availability.prerequisites.privateStorageConfigured ? 'READY_FOR_PAID_GENERATION' : 'PAID_IMAGE_GENERATION_DISABLED',
      access,
      monthlySpendingLimitUsd: budget.ceilingUsd,
      prerequisites: { ...availability.prerequisites, budgetActivated: budget.canReserveOneImage },
      budget: access.allowed ? budget : undefined,
    });
  } catch (error) {
    req.log.warn({ err: error }, 'Image budget readiness unavailable');
    res.json({ ...availability, access, budgetStatus: 'unavailable' });
  }
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
  const input = GenerateInput.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'IMAGE_TRANSFER_ACKNOWLEDGEMENT_REQUIRED_OR_INVALID_REQUEST' }); return; }
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
    const scene = prepareImageScene(input.data.prompt, character, characters, selected);
    const referencePaths = scene.referencePaths;
    const preparedPrompt = scene.preparedPrompt;
    const creditOperation = randomUUID();
    const cost = scene.people.length > 1 ? 2 : 1;
    const charge = await spendCredits(req.userId!, 'photo', cost, creditOperation);
    if (!charge.charged) {
      res.status(402).json({ error: 'INSUFFICIENT_PHOTO_CREDITS', requiredCredits: cost });
      return;
    }
    let result: Awaited<ReturnType<typeof generateCharacterImage>>;
    try {
      result = await generateCharacterImage({
      ownerId: req.userId!, universeId: input.data.universeId,
      characterId: character.id, preparedPrompt, style: selected, referencePaths,
      ...(input.data.sourceObjectPath ? { edit: { sourcePath: input.data.sourceObjectPath, instruction: input.data.prompt } } : {}),
    });
    } catch (generationError) {
      await refundCredits(req.userId!, creditOperation);
      throw generationError;
    }
    res.json({ status: 'generated', objectPath: result.objectPath, billedUsd: result.billedUsd, jobId: result.jobId, chargedPhotoCredits: cost });
  } catch (error) {
    req.log.error({ err: error }, 'Image generation failed');
    res.status(503).json({ error: 'IMAGE_GENERATION_UNAVAILABLE' });
  }
});

export default router;
