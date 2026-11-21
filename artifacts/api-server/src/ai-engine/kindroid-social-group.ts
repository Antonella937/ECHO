import { kindroidPeerGroupProvider } from './kindroid';
import { EngineError, type TextProvider } from './contracts';

/**
 * Context injection for a dedicated, manually provisioned Kindroid social
 * group. This helper never targets a private ai_id conversation and must not
 * be wired until the group's memory settings are verified separately.
 */
export async function sendKindroidSocialGroupContext(
  groupId: string,
  context: string,
  request: typeof fetch = fetch,
): Promise<void> {
  const key = process.env.ECHO_KINDROID_API_KEY;
  if (!key) throw new EngineError('KINDROID_KEY_MISSING', 503);
  if (!/^[A-Za-z0-9_-]{8,160}$/.test(groupId)) throw new EngineError('KINDROID_GROUP_ID_INVALID', 400);
  if (!context.trim() || context.length > 1500) throw new EngineError('KINDROID_SOCIAL_CONTEXT_INVALID', 400);
  const response = await request('https://api.kindroid.ai/v1/groupchats-user-message', {
    method: 'POST',
    signal: AbortSignal.timeout(90000),
    headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ group_id: groupId, message: context }),
  });
  if (!response.ok) {
    throw new EngineError(response.status === 429 ? 'KINDROID_RATE_LIMITED' : 'KINDROID_SOCIAL_GROUP_CONTEXT_FAILED', response.status === 429 ? 429 : 502);
  }
}

/**
 * Prepared social-only group adapter. Must be used only after a dedicated
 * group mapping and memory settings have been verified. Caller is responsible
 * for serializing requests per group; concurrent social events must not
 * interleave their prompts and responses.
 */
const groupQueues = new Map<string, Promise<void>>();

async function withGroupLock<T>(groupId: string, run: () => Promise<T>): Promise<T> {
  const previous = groupQueues.get(groupId) ?? Promise.resolve();
  let release!: () => void;
  const current = new Promise<void>(resolve => { release = resolve; });
  const tail = previous.then(() => current);
  groupQueues.set(groupId, tail);
  await previous;
  try { return await run(); }
  finally { release(); if (groupQueues.get(groupId) === tail) groupQueues.delete(groupId); }
}

export function kindroidSocialGroupProvider(
  groupId: string,
  kinId: string,
  situation: 'post' | 'comment' | 'like_post' | 'like_comment' | 'story_reaction',
  context: string,
  echoCharacterId?: string,
  request: typeof fetch = fetch,
): TextProvider {
  return {
    name: 'kindroid',
    async complete(input) {
      return withGroupLock(groupId, async () => {
      const choices = situation === 'story_reaction'
        ? 'VIEW, LIKE, LAUGH, SURPRISE, FIRE'
        : situation.startsWith('like_') ? 'LIKE, SKIP' : '';
      const instruction = choices
        ? `ECHO social event for ${situation}. Respond with exactly one of: ${choices}. No narration.`
        : `ECHO social event for ${situation}. Write only a natural English ${situation === 'post' ? 'feed caption' : 'public comment'} in your voice, or SKIP if you would not engage. No narration.`;
      // Kindroid determines the next Kin after receiving the group user message.
      // Do not preflight get-turn here: an idle group may legitimately have
      // the user turn, which would reject every first social event.
      // The group provider verifies the Kin before requesting AI generation.
      await sendKindroidSocialGroupContext(groupId, `${instruction}\n${context.slice(0, 1050)}`, request);
      const generated = await kindroidPeerGroupProvider(groupId, kinId, echoCharacterId, request).complete({
        ...input, validate: undefined,
      });
      let envelope: unknown;
      try { envelope = JSON.parse(generated.text); }
      catch { throw new EngineError('KINDROID_SOCIAL_RESPONSE_INVALID', 502); }
      if (!envelope || typeof envelope !== 'object' || Array.isArray(envelope) ||
          typeof (envelope as { text?: unknown }).text !== 'string') {
        throw new EngineError('KINDROID_SOCIAL_RESPONSE_INVALID', 502);
      }
      const reply = (envelope as { text: string }).text.trim();
      const cleaned = reply.replace(/^START MESSAGE\s*\n/i, '').replace(/\n\s*END MESSAGE$/i, '').trim();
      let action: string = 'draft';
      let text: string | null = null;
      let reaction: string | null = null;
      if (choices) {
        const token = cleaned.toUpperCase();
        if (!choices.split(', ').includes(token)) throw new EngineError('KINDROID_SOCIAL_DECISION_INVALID', 502);
        if (situation === 'story_reaction') {
          reaction = ({ LIKE: '❤', LAUGH: '😂', SURPRISE: '😮', FIRE: '🔥' } as Record<string, string>)[token] ?? null;
          action = reaction ? 'react' : 'none';
        } else {
          action = token === 'LIKE' ? 'like' : 'none';
        }
      } else if (cleaned.toUpperCase() === 'SKIP') {
        action = 'none';
      } else {
        text = cleaned.slice(0, situation === 'post' ? 600 : 1000);
        if (!text) throw new EngineError('KINDROID_SOCIAL_DECISION_INVALID', 502);
      }
      const decision = JSON.stringify({
        action, situation, text, reaction, reason: 'Isolated Kindroid social group',
        suggestedDelayMinutes: 0, galleryPhotoId: null, contextSections: [],
      });
      input.validate?.(decision);
      return { ...generated, text: decision };
      });
    },
  };
}
