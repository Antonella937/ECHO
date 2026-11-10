import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { randomUUID } from 'node:crypto';
import { spendCredits, refundCredits } from '../lib/creditWallet';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';
import { db, echoMediaTable } from '@workspace/db';
import { and, eq, inArray } from 'drizzle-orm';
import { saveGeneratedImage } from '../lib/generatedImageStorage';
import { imageGenerationAvailability } from '../lib/imageGenerationProvider';
import { buildCharacterImagePrompt, imageStyleInstructions } from '../lib/imagePromptBuilder';
import { prepareImageScene } from '../lib/imageScenePreparation';
import { imageGenerationAccessStatus } from '../lib/imageGenerationAccess';
import { paidImageGenerationActivated } from '../lib/imageGenerationActivation';
import { generateCharacterImage } from '../lib/imageGenerationService';
import { readImageBudgetReadiness } from '../lib/imageBudgetReadiness';
import { probeFalImagePricing } from '../lib/falProviderPreflight';

/**
 * Image generation preparation. Strictly NO provider calls, no paid operations.
 * The active character and its identity come from the owner's persisted universe,
 * never from untrusted client-supplied reference URLs or descriptions.
 */
const Input = z.object({
  universeId: z.string().min(1).max(120).default('primary'),
  characterId: z.string().min(1).max(120),
  prompt: z.string().trim().min(3).max(2000),
  selectedCharacterIds: z.array(z.string().min(1).max(120)).max(3).refine(ids => new Set(ids).size === ids.length).optional(),
  selectedReferencePaths: z.record(z.string().min(1).max(120), z.string().regex(/^\\/objects\\/uploads\\/[0-9a-f-]{36}$/i)).optional(),
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
    if (input.data.selectedCharacterIds?.includes(character.id)) {
      res.status(400).json({ error: 'ACTIVE_CHARACTER_MUST_NOT_BE_DUPLICATED' }); return;
    }
    const identity = character.identity ?? {};
    const selected = typeof state.imageStyle === 'string' && state.imageStyle in imageStyleInstructions
      ? state.imageStyle as keyof typeof imageStyleInstructions : 'natural';
    const scene = prepareImageScene(input.data.prompt, character, characters, selected, input.data.selectedCharacterIds, input.data.selectedReferencePaths);
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

/**
 * Non-billable private beta provider check. No prompt, reference media,
 * or charge is sent to fal.ai. This does not activate paid generation.
 */
router.get('/ai-engine/images/provider-check', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (!imageGenerationAccessStatus(req.userId).allowed) {
    res.status(403).json({ error: 'IMAGE_GENERATION_ACCOUNT_NOT_ALLOWED' });
    return;
  }
  const key = process.env.FAL_KEY;
  if (!key) {
    res.status(503).json({ verified: false, error: 'FAL_KEY_MISSING' });
    return;
  }
  try {
    const pricing = await probeFalImagePricing(key);
    res.json({ verified: true, paidRequestMade: false, pricing });
  } catch (error) {
    req.log.warn({ err: error }, 'fal.ai non-billable provider preflight failed');
    res.status(503).json({ verified: false, paidRequestMade: false, error: 'FAL_PROVIDER_PREFLIGHT_FAILED' });
  }
});

router.get('/ai-engine/images/status', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  const access = imageGenerationAccessStatus(req.userId);
  const availability = imageGenerationAvailability();
  try {
    const budget = await readImageBudgetReadiness();
    // Report account eligibility and budget readiness without a paid request.
    res.json({
      ...availability,
      enabled: availability.enabled && access.allowed && budget.canReserveOneImage,
      reason: !access.allowed ? 'IMAGE_GENERATION_ACCOUNT_NOT_ALLOWED' :
        !availability.enabled ? 'PAID_IMAGE_GENERATION_DISABLED' :
        !budget.canReserveOneImage ? 'IMAGE_BUDGET_NOT_READY' : 'READY_FOR_PAID_GENERATION',
      access,
      monthlySpendingLimitUsd: budget.ceilingUsd,
      prerequisites: { ...availability.prerequisites, budgetActivated: budget.canReserveOneImage },
      budget: access.allowed ? budget : undefined,
    });
  } catch (error) {
    req.log.warn({ err: error }, 'Image budget readiness unavailable');
    res.json({ ...availability, enabled: false, reason: 'IMAGE_BUDGET_STATUS_UNAVAILABLE', access, budgetStatus: 'unavailable', monthlySpendingLimitUsd: 0, prerequisites: { ...availability.prerequisites, budgetActivated: false } });
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
    const scene = prepareImageScene(input.data.prompt, character, characters, selected, input.data.selectedCharacterIds, input.data.selectedReferencePaths);
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
    res.json({ status: 'generated', objectPath: result.objectPath, estimatedCostUsd: result.billedUsd, costReconciled: false, jobId: result.jobId, chargedPhotoCredits: cost });
  } catch (error) {
    const code = error instanceof Error ? error.message : '';
    if (code === 'IMAGE_LAUNCH_ACCOUNT_LIMIT_REACHED') {
      res.status(429).json({ error: 'IMAGE_BETA_ATTEMPT_LIMIT_REACHED', retrySameRequest: false, chargedPhotoCredits: 0 });
      return;
    }
    if (code === 'IMAGE_MONTHLY_BUDGET_EXHAUSTED_OR_DISABLED') {
      res.status(429).json({ error: 'IMAGE_MONTHLY_BUDGET_EXHAUSTED', retrySameRequest: false, chargedPhotoCredits: 0 });
      return;
    }
    if (code === 'FAL_IMAGE_CONTENT_POLICY_REFERENCES' || code === 'FAL_IMAGE_CONTENT_POLICY_PROMPT') {
      req.log.warn({ reason: code }, 'Image request rejected by provider policy');
      res.status(422).json({ error: 'IMAGE_CONTENT_POLICY_REJECTED',
        rejectedInput: code.endsWith('REFERENCES') ? 'references' : 'prompt',
        chargedPhotoCredits: 0, retrySameRequest: false });
      return;
    }
    req.log.error({ err: error }, 'Image generation failed');
    res.status(503).json({ error: 'IMAGE_GENERATION_UNAVAILABLE' });
  }
});

/**
 * One-shot private storage diagnostic. Disabled unless explicitly enabled in
 * Render and restricted to an allowlisted authenticated tester.
 * Uses a tiny synthetic PNG; never calls fal.ai or reads personal photos.
 */
router.post('/ai-engine/images/storage-self-test', requireAuth, async (req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (process.env.ECHO_IMAGE_STORAGE_SELF_TEST_ENABLED !== 'true' ||
      !imageGenerationAccessStatus(req.userId).allowed) {
    res.status(404).json({ error: 'NOT_FOUND' });
    return;
  }
  // A synthetic 1x1 PNG, never a user photo or a paid provider request.
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAADUlEQVQIHWP4z8DwHwAFgAI/ScL/nwAAAABJRU5ErkJggg==', 'base64');
  let objectPath: string | undefined;
  let uploaded = false;
  let readBack = false;
  let storageDeleted = false;
  let recordDeleted = false;
  let failure: unknown;
  try {
    objectPath = await saveGeneratedImage(req.userId!, png, 'image/png');
    uploaded = true;
    const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
    const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
    if (!base || !key) throw Error('STORAGE_NOT_CONFIGURED');
    const remotePath = objectPath.slice('/objects/'.length);
    const url = `${base}/storage/v1/object/echo-media/${remotePath}`;
    const headers = { Authorization: `Bearer ${key}`, apikey: key };
    const response = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
    if (!response.ok) throw Error('STORAGE_SELF_TEST_READ_FAILED');
    const received = Buffer.from(await response.arrayBuffer());
    if (!received.equals(png)) throw Error('STORAGE_SELF_TEST_CONTENT_MISMATCH');
    readBack = true;
  } catch (error) {
    failure = error;
    req.log.error({ err: error }, 'Image storage self-test failed');
  }
  if (objectPath) {
    try {
      const base = process.env.SUPABASE_URL?.replace(/\/$/, '');
      const key = process.env.SUPABASE_SERVICE_ROLE_KEY;
      if (!base || !key) throw Error('STORAGE_NOT_CONFIGURED');
      const remotePath = objectPath.slice('/objects/'.length);
      const url = `${base}/storage/v1/object/echo-media/${remotePath}`;
      const headers = { Authorization: `Bearer ${key}`, apikey: key };
      const deletion = await fetch(url, { method: 'DELETE', headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (!deletion.ok) throw Error('STORAGE_SELF_TEST_DELETE_FAILED');
      const check = await fetch(url, { headers, redirect: 'error', signal: AbortSignal.timeout(10000) });
      if (check.ok) throw Error('STORAGE_SELF_TEST_DELETE_NOT_CONFIRMED_OBJECT_STILL_READABLE');
      // Supabase Storage can report a missing object as HTTP 400 or 404,
      // depending on the storage API version. Verify the structured error,
      // not only the HTTP status, to avoid treating other 400s as success.
      const missingBody = await check.text();
      let missingCode = '';
      try {
        const parsed = JSON.parse(missingBody) as { error?: string; code?: string; message?: string; statusCode?: string };
        missingCode = [parsed.error, parsed.code, parsed.message, parsed.statusCode].filter(Boolean).join(' ').toLowerCase();
      } catch {}
      const confirmedMissing = check.status === 404 ||
        (check.status === 400 && /not.?found|does not exist|no such object|resource not found/i.test(missingCode));
      if (!confirmedMissing) {
        req.log.warn({ status: check.status, errorCode: missingCode.slice(0, 160) }, 'Supabase deletion verification unexpected response');
        throw Error('STORAGE_SELF_TEST_DELETE_NOT_CONFIRMED');
      }
      storageDeleted = true;
      await db.delete(echoMediaTable).where(and(
        eq(echoMediaTable.ownerId, req.userId!), eq(echoMediaTable.objectPath, objectPath),
      ));
      const remaining = await db.select({ objectPath: echoMediaTable.objectPath }).from(echoMediaTable)
        .where(and(eq(echoMediaTable.ownerId, req.userId!), eq(echoMediaTable.objectPath, objectPath))).limit(1);
      if (remaining.length) throw Error('STORAGE_SELF_TEST_DB_DELETE_NOT_CONFIRMED');
      recordDeleted = true;
    } catch (error) {
      failure ??= error;
      req.log.error({ err: error, objectPath }, 'Image storage self-test cleanup requires attention');
    }
  }
  const passed = !failure && uploaded && readBack && storageDeleted && recordDeleted;
  res.status(passed ? 200 : 503).json({
    status: passed ? 'passed' : 'failed', uploaded, readBack, storageDeleted, recordDeleted,
  });
});

export default router;
