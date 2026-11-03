import { Router, type IRouter } from 'express';
import { PreviewCharacterDecisionBody } from '@workspace/api-zod';
import { SaveUniverseBody } from '@workspace/api-zod';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';
import { previewForOwner } from '../ai-engine/service';
import { FreeModelProvider } from '../ai-engine/free-models';
import { EngineError } from '../ai-engine/contracts';
import { z } from 'zod';
import { VisionError } from '../vision/contracts';
import { visionService } from '../vision/service';
import { MeteredTextProvider } from '../lib/metered-ai';

const router: IRouter = Router();
const provider = new FreeModelProvider();
const gates = new Map<string, { running: boolean; until: number }>();
const visionRunning = new Set<string>();
const VisionAnalyzeBody = z.object({
  postId: z.string().trim().min(1).max(120).optional(),
  storyId: z.string().trim().min(1).max(120).optional(),
}).strict().refine(value => Boolean(value.postId) !== Boolean(value.storyId));

router.post('/ai-engine/vision/analyze', requireAuth, async (req, res): Promise<void> => {
  const input = VisionAnalyzeBody.safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'INVALID_VISION_INPUT' }); return; }
  const owner = req.userId!;
  if (visionRunning.has(owner)) {
    res.setHeader('Retry-After', '3');
    res.status(429).json({ error: 'VISION_OWNER_REQUEST_IN_PROGRESS' });
    return;
  }
  visionRunning.add(owner);
  try {
    const snapshot = await readUniverse(owner);
    if (!snapshot.state) { res.status(404).json({ error: 'UNIVERSE_NOT_FOUND' }); return; }
    const stored = SaveUniverseBody.safeParse({ state: snapshot.state, expectedRevision: snapshot.revision });
    if (!stored.success) { res.status(422).json({ error: 'INVALID_STORED_UNIVERSE' }); return; }
    const result = input.data.postId
      ? await visionService.analyzePost(owner, stored.data.state, input.data.postId)
      : await visionService.analyzeStory(owner, stored.data.state, input.data.storyId!);
    res.json({ ...result, summary: 'summary' in result ? result.summary : null,
      skippedVideoCount: 'skippedVideoCount' in result ? result.skippedVideoCount : 0 });
  } catch (error) {
    if (error instanceof VisionError) {
      req.log.warn({ code: error.code }, 'Vision analysis failed');
      res.status(error.status).json({ error: error.code, attempts: error.attempts });
      return;
    }
    req.log.warn({ code: 'VISION_ANALYSIS_FAILED' }, 'Vision analysis failed');
    res.status(502).json({ error: 'VISION_ANALYSIS_FAILED', attempts: [] });
  } finally {
    visionRunning.delete(owner);
  }
});

router.post('/ai-engine/preview', requireAuth, async (req, res): Promise<void> => {
  const input = PreviewCharacterDecisionBody.strict().safeParse(req.body);
  if (!input.success) { res.status(400).json({ error: 'INVALID_PREVIEW_INPUT' }); return; }
  const owner = req.userId!;
  const now = Date.now();
  for (const [id, gate] of gates) if (!gate.running && gate.until <= now) gates.delete(id);
  const gate = gates.get(owner);
  if (gate?.running || (gate && gate.until > now)) {
    res.setHeader('Retry-After', '5');
    res.status(429).json({ error: 'PREVIEW_BUSY_OR_COOLDOWN' }); return;
  }
  gates.set(owner, { running: true, until: now + 5000 });
  try {
    res.json(await previewForOwner(owner, input.data, {
      read: readUniverse,
      provider: new MeteredTextProvider(owner, "brain_text", provider),
      vision: (ownerId, state, decisionInput) => visionService.ensureForDecision(ownerId, state, decisionInput),
    }));
  } catch (error) {
    // No context, generated content, provider error text or secret in logs.
    if (error instanceof VisionError) {
      req.log.warn({ code: error.code }, 'Vision context load failed');
      res.status(error.status).json({ error: error.code, executed: false, attempts: error.attempts, contextAudit: null });
      return;
    }
    const safe = error instanceof EngineError ? error : new EngineError('PREVIEW_FAILED', 502);
    req.log.warn({ code: safe.code }, 'Manual character preview failed');
    if (safe.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(safe.retryAfterMs / 1000)));
    res.status(safe.status).json({ error: safe.code, executed: false, attempts: safe.attempts ?? [], contextAudit: safe.contextAudit ?? null });
  } finally {
    gates.set(owner, { running: false, until: Date.now() + 5000 });
  }
});
export default router;
