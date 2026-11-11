import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { sql } from 'drizzle-orm';
import { db } from '@workspace/db';
import { requireAuth } from '../middlewares/requireAuth';

/**
 * Private creator inspection only. No public social API exposes these thoughts.
 * Read-only by design until the generation/permission pipeline is complete.
 */
export const internalReactionsRouter: IRouter = Router();
const query = z.object({
  universeId: z.string().min(1).max(120).default('primary'),
  surface: z.enum(['post','story']),
  contentId: z.string().min(1).max(255),
}).strict();

internalReactionsRouter.get('/internal-reactions', requireAuth, async (req,res): Promise<void> => {
  res.setHeader('Cache-Control', 'private, no-store');
  if (req.userId !== 'user_3LeoBfUicTthDVixNbkPlqXFkdZ') {
    res.status(403).json({error:'INTERNAL_REACTIONS_NOT_AVAILABLE'}); return;
  }
  const parsed = query.safeParse(req.query);
  if (!parsed.success) { res.status(400).json({error:'INVALID_INTERNAL_REACTIONS_QUERY'}); return; }
  try {
    const rows = await db.execute(sql`
      SELECT character_id, surface, content_id, mode, reaction_text, actually_viewed, generated_at
      FROM echo_internal_reactions
      WHERE owner_id = ${req.userId!}
        AND universe_id = ${parsed.data.universeId}
        AND surface = ${parsed.data.surface}
        AND content_id = ${parsed.data.contentId}
      ORDER BY generated_at DESC LIMIT 50
    `);
    res.json({reactions:rows.rows});
  } catch {
    res.status(503).json({error:'INTERNAL_REACTIONS_UNAVAILABLE'});
  }
});
