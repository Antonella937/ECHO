import { Router, type IRouter } from 'express';
import { SaveUniverseBody } from '@workspace/api-zod';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';
import { z } from 'zod';
import { VisionError } from '../vision/contracts';
import { visionService } from '../vision/service';
import { brainPreviewRouter } from './brain-preview';

const router: IRouter = Router();
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

router.use(brainPreviewRouter);

export default router;
