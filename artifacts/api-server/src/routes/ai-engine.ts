import { Router, type IRouter } from 'express';
import { PreviewCharacterDecisionBody } from '@workspace/api-zod';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';
import { previewForOwner } from '../ai-engine/service';
import { FreeModelProvider } from '../ai-engine/free-models';
import { EngineError } from '../ai-engine/contracts';

const router: IRouter = Router();
const provider = new FreeModelProvider();
const gates = new Map<string, { running: boolean; until: number }>();
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
    res.json(await previewForOwner(owner, input.data, { read: readUniverse, provider }));
  } catch (error) {
    // No context, generated content, provider error text or secret in logs.
    const safe = error instanceof EngineError ? error : new EngineError('PREVIEW_FAILED', 502);
    req.log.warn({ code: safe.code }, 'Manual character preview failed');
    if (safe.retryAfterMs) res.setHeader('Retry-After', String(Math.ceil(safe.retryAfterMs / 1000)));
    res.status(safe.status).json({ error: safe.code, executed: false, attempts: safe.attempts ?? [], contextAudit: safe.contextAudit ?? null });
  } finally {
    gates.set(owner, { running: false, until: Date.now() + 5000 });
  }
});
export default router;
