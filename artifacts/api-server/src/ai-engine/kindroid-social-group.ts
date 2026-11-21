import { EngineError } from './contracts';

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
