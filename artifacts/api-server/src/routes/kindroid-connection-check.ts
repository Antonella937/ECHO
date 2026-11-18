import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '@workspace/db';
import { requireAuth } from '../middlewares/requireAuth';

const Query = z.object({
  characterId: z.string().trim().min(1).max(120),
  universeId: z.string().trim().min(1).max(120).optional(),
}).strict();

/**
 * Owner-only, read-only Kindroid connectivity diagnostic.
 * Never returns Kin IDs, credentials, chat history or upstream response bodies.
 * Does not send a message, regenerate a response, or change a Kin.
 */
export function createKindroidConnectionCheckRouter(): IRouter {
  const router: IRouter = Router();
  const lastCheck = new Map<string, number>();
  router.get('/ai-engine/kindroid/connection-check', requireAuth, async (req, res): Promise<void> => {
    const parsed = Query.safeParse(req.query);
    if (!parsed.success) { res.status(400).json({ error: 'INVALID_CHECK_INPUT' }); return; }
    const owner = req.userId!;
    const now = Date.now();
    const previous = lastCheck.get(owner) ?? 0;
    if (now - previous < 60_000) {
      res.setHeader('Retry-After', String(Math.ceil((60_000 - (now - previous)) / 1000)));
      res.status(429).json({ error: 'CHECK_COOLDOWN' });
      return;
    }
    lastCheck.set(owner, now);
    const key = process.env.ECHO_KINDROID_API_KEY;
    if (!key) { res.status(503).json({ error: 'KINDROID_KEY_MISSING' }); return; }
    try {
      const links = await db.execute(sql`SELECT kin_id FROM echo_kindroid_character_links
        WHERE owner_id = ${owner} AND universe_id = ${parsed.data.universeId ?? 'primary'}
          AND character_id = ${parsed.data.characterId} AND enabled = true LIMIT 1`);
      const kinId = links.rows[0]?.kin_id;
      if (typeof kinId !== 'string' || !/^[A-Za-z0-9_-]{8,160}$/.test(kinId)) {
        res.status(404).json({ error: 'ACTIVE_KIN_LINK_NOT_FOUND' }); return;
      }
      const url = new URL('https://api.kindroid.ai/v1/get-chat-messages');
      url.searchParams.set('ai_id', kinId);
      url.searchParams.set('limit', '1');
      const upstream = await fetch(url, {
        method: 'GET',
        headers: { Authorization: `Bearer ${key}` },
        signal: AbortSignal.timeout(12000),
      });
      // Do not parse, log, or return the conversation, even if the request succeeds.
      await upstream.body?.cancel().catch(() => undefined);
      const status = upstream.status;
      const category = status === 200 ? 'accessible'
        : status === 400 ? 'bad_request'
        : status === 401 ? 'authentication'
        : status === 403 ? 'permission'
        : status === 404 ? 'not_found'
        : status === 429 ? 'rate_limited'
        : status >= 500 ? 'provider_error' : 'other';
      res.setHeader('Cache-Control', 'no-store');
      res.json({ reachable: status === 200, providerStatus: status, category, readOnly: true });
    } catch {
      res.status(502).json({ error: 'KINDROID_CONNECTION_CHECK_FAILED' });
    }
  });
  return router;
}

export const kindroidConnectionCheckRouter = createKindroidConnectionCheckRouter();
