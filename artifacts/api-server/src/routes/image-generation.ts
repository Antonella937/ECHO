import { Router, type IRouter } from 'express';
import { z } from 'zod';
import { requireAuth } from '../middlewares/requireAuth';
import { readUniverse } from '../lib/universeRepository';

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
const styles = {
  natural: 'Natural candid photorealism, realistic skin texture, pores, natural imperfections, believable lighting.',
  phone: 'Photorealistic smartphone snapshot, spontaneous framing, realistic flash or ambient light, subtle digital noise.',
  analog: 'Photorealistic 35mm film photography, fine film grain, organic colors, authentic analog exposure.',
  editorial: 'Photorealistic editorial fashion photography, professional but believable lighting, realistic skin and anatomy.',
  cinematic: 'Photorealistic cinematic still, dramatic naturalistic light, deep shadows, realistic proportions.',
} as const;
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
    const selected = typeof state.imageStyle === 'string' && state.imageStyle in styles
      ? state.imageStyle as keyof typeof styles : 'natural';
    const descriptions = [identity.facialDescription, identity.bodyDescription, identity.appearance, identity.styleNotes]
      .filter((v): v is string => typeof v === 'string' && v.trim().length > 0)
      .map(v => v.slice(0, 4000));
    const candidates = [character.avatar, ...(Array.isArray(identity.referenceImages) ? identity.referenceImages : [])];
    const references = [...new Set(candidates.filter((v): v is string =>
      typeof v === 'string' && /^\/objects\/uploads\/[0-9a-f-]{36}$/i.test(v)))].slice(0, 4);
    const preparedPrompt = [
      'Create a believable real photograph, not an illustration, doll, render or beauty-filtered image.',
      styles[selected],
      'Keep the same character identity, facial proportions, distinctive marks and physical details as the provided references.',
      `Character: ${String(character.name ?? '').slice(0, 160)}.`,
      ...descriptions,
      `Scene: ${input.data.prompt}.`,
      'Avoid waxy/plastic skin, artificial symmetry, airbrushing and uncanny facial features.',
    ].join('\n');
    res.json({
      status: 'preview_only',
      generationEnabled: false,
      paidCallsMade: 0,
      characterId: character.id,
      characterName: character.name,
      style: selected,
      referenceCount: references.length,
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

router.post('/ai-engine/images/generate', requireAuth, (_req, res) => {
  res.setHeader('Cache-Control', 'private, no-store');
  res.status(503).json({ error: 'IMAGE_GENERATION_DISABLED', generationEnabled: false, paidCallsMade: 0 });
});

export default router;
