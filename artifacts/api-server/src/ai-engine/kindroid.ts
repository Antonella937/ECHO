import { createHash, randomUUID } from 'node:crypto';
import { EngineError, unknownUsage, type TextProvider } from './contracts';

/** Classify upstream errors without persisting response bodies or private messages. */
async function classifyKindroidFailure(response: Response): Promise<{category:string; providerCode:string; errorFormat:string; errorFingerprint:string}> {
  const result = (category:string, providerCode='unavailable', errorFormat='unknown', errorFingerprint='unavailable') => ({category,providerCode,errorFormat,errorFingerprint});
  if (response.status === 429) return result('rate_limit');
  if (response.status === 401 || response.status === 403) return result('authorization');
  if (response.status === 404) return result('not_found');
  if (response.status >= 500) return result('upstream_server');
  if (response.status !== 400 && response.status !== 422) return result('other_http');
  try {
    const raw = (await response.text()).slice(0, 2048).toLowerCase();
    // Stable fingerprint only: never log the provider's raw error, which could
    // contain message text, Kin IDs or other private information.
    const errorFingerprint = createHash('sha256').update(raw).digest('hex').slice(0, 12);
    let providerCode = 'unavailable';
    let errorFormat = 'plain_text';
    try {
      const parsed: unknown = JSON.parse(raw);
      if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
        const record = parsed as Record<string,unknown>;
        const nested = record.error && typeof record.error === 'object' && !Array.isArray(record.error) ? record.error as Record<string,unknown> : null;
        errorFormat = nested ? 'json_nested_error' : 'json_object';
        const code = [record.code, record.error_code, nested?.code, nested?.error_code].find(value => typeof value === 'string' && /^[a-z][a-z0-9_-]{0,63}$/i.test(value)) as string | undefined;
        if (code) providerCode = code.toLowerCase();
      }
    } catch { /* Provider may return plain text; never log it. */ }
    // Classify provider-side generation failures without exposing their text.
    // Kindroid can return a textual error envelope even with HTTP 400.
    if (/(?:<<error>>|beep boop|server melted|regenerate this response|generation (?:failed|error)|failed to generate|model (?:unavailable|overloaded|busy))/.test(raw)) return result('provider_generation_failure',providerCode,errorFormat,errorFingerprint);
    if (/(?:invalid|expired|revoked|missing|unauthorized).{0,45}(?:api[_ -]?key|token|bearer|authorization)|(?:api[_ -]?key|token|bearer|authorization).{0,45}(?:invalid|expired|revoked|missing|unauthorized)/.test(raw)) return result('credential_rejected',providerCode,errorFormat,errorFingerprint);
    if (/(?:endpoint|route|method|send-message).{0,45}(?:invalid|unknown|unsupported|not found|disabled)|(?:invalid|unknown|unsupported|not found|disabled).{0,45}(?:endpoint|route|method|send-message)/.test(raw)) return result('endpoint_rejected',providerCode,errorFormat,errorFingerprint);
    // Categorize known provider rejections without logging raw response text,
    // Kin identifiers, API credentials, or private message content.
    if (/(?:not found|does not exist|unknown|deleted|invalid|unrecognized|not accessible|not available).{0,50}(?:kin|ai[_ -]?id|character)|(?:kin|ai[_ -]?id|character).{0,50}(?:not found|does not exist|unknown|deleted|invalid|unrecognized|not accessible|not available)/.test(raw)) return result('invalid_character',providerCode,errorFormat,errorFingerprint);
    if (/(?:subscription|plan|tier|api access|api permission|api enabled|api disabled|api limit|quota|credits|billing)/.test(raw)) return result('account_restriction',providerCode,errorFormat,errorFingerprint);
    if (/(?:chat|conversation|history|context).{0,45}(?:unavailable|invalid|disabled|locked|missing|not found|limit|exceeded)|(?:unavailable|invalid|disabled|locked).{0,45}(?:chat|conversation|history)/.test(raw)) return result('conversation_restriction',providerCode,errorFormat,errorFingerprint);
    if (/(?:internal error|server error|service unavailable|temporarily unavailable|maintenance|overloaded)/.test(raw)) return result('upstream_unavailable',providerCode,errorFormat,errorFingerprint);
    if (/invalid (?:ai[_ -]?id|kin[_ -]?id|character)|(?:ai[_ -]?id|kin[_ -]?id|character) (?:invalid|not found|does not exist)|character not found/.test(raw)) return result('invalid_character',providerCode,errorFormat,errorFingerprint);
    if (/(?:message (?:is )?(?:invalid|missing|too long)|invalid message)|(?:length|content) (?:limit|exceeded|invalid)|too long/.test(raw)) return result('invalid_message',providerCode,errorFormat,errorFingerprint);
    if (/(?:invalid|missing|unexpected|unsupported) (?:stream|parameter|field|payload|json)|(?:stream|parameter|field|payload|json) (?:invalid|missing|unsupported)/.test(raw)) return result('invalid_payload',providerCode,errorFormat,errorFingerprint);
    return result('bad_request_unknown',providerCode,errorFormat,errorFingerprint);
  } catch {
    return result('unreadable_error');
  }
}

// Shared per-process queue for all Kindroid generation and story calls.
// The private Hyunjin Kin is prioritized within each priority class.
// The queue does not preempt requests already in flight.
const PRIVATE_HYUNJIN_ECHO_ID = 'account_mw7bvivjs2rpd';
type KindroidJob = { priority: number; sequence: number; run: () => Promise<Response>; resolve: (value: Response) => void; reject: (reason: unknown) => void };
const kindroidJobs: KindroidJob[] = [];
const recentKindroidStarts: number[] = [];
let kindroidSequence = 0;
let kindroidRunning = false;
const waitForKindroidSlot = (ms: number) => new Promise<void>(resolve => setTimeout(resolve, ms));
async function drainKindroidQueue(): Promise<void> {
  if (kindroidRunning) return;
  kindroidRunning = true;
  try {
    while (kindroidJobs.length) {
      const now = Date.now();
      while (recentKindroidStarts.length && recentKindroidStarts[0] <= now - 30000) recentKindroidStarts.shift();
      const spacing = recentKindroidStarts.length ? Math.max(0, recentKindroidStarts[recentKindroidStarts.length - 1] + 4000 - now) : 0;
      const windowWait = recentKindroidStarts.length >= 8 ? Math.max(0, recentKindroidStarts[0] + 30000 - now) : 0;
      const delay = Math.max(spacing, windowWait);
      if (delay) { await waitForKindroidSlot(delay); continue; }
      kindroidJobs.sort((a, b) => b.priority - a.priority || a.sequence - b.sequence);
      const job = kindroidJobs.shift()!;
      recentKindroidStarts.push(Date.now());
      try { job.resolve(await job.run()); } catch (error) { job.reject(error); }
    }
  } finally {
    kindroidRunning = false;
    if (kindroidJobs.length) void drainKindroidQueue();
  }
}
function queuedKindroidRequest(kinId: string, priority: number, run: () => Promise<Response>, echoCharacterId?: string): Promise<Response> {
  return new Promise<Response>((resolve, reject) => {
    kindroidJobs.push({ priority: priority + (echoCharacterId === PRIVATE_HYUNJIN_ECHO_ID ? 100 : 0), sequence: kindroidSequence++, run, resolve, reject });
    void drainKindroidQueue();
  });
}

/** Private, opt-in Kindroid DM adapter. No profile changes, chat breaks, or social autonomy. */
export function kindroidDmProvider(message: string, kinId: string, socialContext = '', request: typeof fetch = fetch, situation: 'dm' | 'comment' | 'post' = 'dm', echoCharacterId?: string): TextProvider {
  return {
    name: 'kindroid',
    async complete(input) {
      const key = process.env.ECHO_KINDROID_API_KEY;
      if (!key) throw new EngineError('KINDROID_KEY_MISSING', 503);
      if (!message.trim()) throw new EngineError('KINDROID_MESSAGE_MISSING', 400);
      if (!/^[A-Za-z0-9_-]{8,160}$/.test(kinId)) throw new EngineError('KINDROID_ID_INVALID', 400);
      // The caller supplies social context only for an explicitly resolved story.
      // Do not infer a reference from incidental words in a DM.
      const relevantSocialContext = socialContext.trim();
      // Keep the newest user turn intact. Optional visual/story context must
      // never push any part of the actual DM out of the request.
      const maxChars = 2800;
      // Never silently discard a user's words. Let the caller surface a
      // recoverable error rather than send a misleading partial DM to Kindroid.
      if (message.length > maxChars) throw new EngineError('KINDROID_MESSAGE_TOO_LONG', 400);
      const userTurn = message;
      const contextHead = '[ECHO observed context]\n';
      const contextTail = '\n[End context]\n\n';
      const availableContextChars = Math.max(0, maxChars - userTurn.length - contextHead.length - contextTail.length);
      const contextPrefix = relevantSocialContext && availableContextChars > 0
        ? contextHead + relevantSocialContext.slice(0, Math.min(500, availableContextChars)) + contextTail
        : '';
      const requestMessage = contextPrefix + userTurn;
      const traceId = randomUUID();
      const startedAt = Date.now();
      console.info('[kindroid] generation dispatch', { traceId, situation, payloadChars: requestMessage.length });
      let response: Response;
      try {
        response = await queuedKindroidRequest(kinId, situation === 'dm' ? 30 : 10, () => request('https://api.kindroid.ai/v1/send-message', {
          method: 'POST',
          signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_id: kinId, message: requestMessage, stream: false }),
        }), echoCharacterId);
      } catch (error) {
        console.warn('[kindroid] generation transport failure', { traceId, situation, elapsedMs: Date.now() - startedAt, kind: error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError') ? 'timeout' : 'network' });
        // No automatic retry: the provider might have received the message
        // before a timeout, and retrying could duplicate a conversation turn.
        throw new EngineError(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'KINDROID_TIMEOUT_RETRY_MANUALLY' : 'KINDROID_CONNECTION_RETRY_MANUALLY', 502);
      }
      if (!response.ok) {
        const { category, providerCode, errorFormat, errorFingerprint } = await classifyKindroidFailure(response);
        console.warn('[kindroid] upstream rejected request', { traceId, elapsedMs: Date.now() - startedAt, situation, status: response.status, category, providerCode, errorFormat, errorFingerprint, payloadChars: requestMessage.length, promptChars: message.length, socialContextChars: relevantSocialContext.length });
        throw new EngineError(response.status === 429 ? 'KINDROID_RATE_LIMITED' : 'KINDROID_REQUEST_FAILED_RETRY_MANUALLY', response.status === 429 ? 429 : 502);
      }
      console.info('[kindroid] generation accepted', { traceId, situation, status: response.status, elapsedMs: Date.now() - startedAt });
      const rawReply = (await response.text()).trim();
      // Kindroid responses may be plain text or a structured JSON response.
      // Never insert a serialized JSON envelope into an ECHO conversation.
      let reply = rawReply;
      if (rawReply.startsWith('{')) {
        try {
          const parsed: unknown = JSON.parse(rawReply);
          if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) {
            const record = parsed as Record<string, unknown>;
            const value = [record.response, record.message, record.text, record.reply]
              .find(candidate => typeof candidate === 'string' && candidate.trim());
            if (typeof value !== 'string') throw new EngineError('KINDROID_RESPONSE_FORMAT_UNSUPPORTED', 502);
            reply = value.trim();
          }
        } catch (error) {
          if (error instanceof EngineError) throw error;
          throw new EngineError('KINDROID_RESPONSE_FORMAT_UNSUPPORTED', 502);
        }
      }
      // Kindroid occasionally includes transport delimiters in its text output.
      // Remove only standalone marker lines, never words inside actual prose.
      reply = reply.split('\\n')
        .filter(line => !/^\\s*(?:(?:<<|\\[|<)\\s*)?(?:start|end)[ _-]*message\\s*(?:(?:>>|\\]|>))?\\s*:?\\s*$/i.test(line))
        .join('\\n').trim();
      if (!reply || reply.startsWith('<<ERROR>>') || reply.startsWith('<<HTTP_ERROR>>')) {
        console.warn('[kindroid] generation returned failure marker', {
          traceId, situation, elapsedMs: Date.now() - startedAt,
          failureKind: !reply ? 'empty_response' : reply.startsWith('<<HTTP_ERROR>>') ? 'http_error_marker' : 'generation_error_marker',
          responseChars: reply.length,
        });
        throw new EngineError('KINDROID_GENERATION_FAILED', 502);
      }
      const decision = JSON.stringify({
        action: 'draft', situation, text: reply.slice(0, situation === 'dm' ? 8000 : situation === 'post' ? 600 : 1000), reason: 'Kindroid character text',
        suggestedDelayMinutes: 0, galleryPhotoId: null, reaction: null, contextSections: [],
      });
      input.validate?.(decision);
      return { text: decision, model: 'kindroid', usage: unknownUsage(), attempts: [] };
    },
  };
}

/** Normalize a short Kindroid social choice without accepting explanatory prose. */
function parseKindroidSocialChoice(raw: string, allowed: readonly string[]): string {
  const cleaned = raw.split('\\n')
    .filter(line => !/^\\s*(?:(?:<<|\\[|<)\\s*)?(?:start|end)[ _-]*message\\s*(?:(?:>>|\\]|>))?\\s*:?\\s*$/i.test(line))
    .join('\\n').trim().replace(/^[\\s"'.,!]+|[\\s"'.,!]+$/g, '').toUpperCase();
  if (!allowed.includes(cleaned)) throw new EngineError('KINDROID_SOCIAL_DECISION_INVALID', 502);
  return cleaned;
}

/**
 * Ask the linked Kin whether to interact with an already-authorized story.
 * The API is conversational: this request may enter Kindroid's history.
 * Keep it short, and fail closed rather than fabricating the Kin's choice.
 */
export function kindroidStoryDecisionProvider(kinId: string, storyContext: string, request: typeof fetch = fetch, echoCharacterId?: string): TextProvider {
  return {
    name: 'kindroid',
    async complete(input) {
      const key = process.env.ECHO_KINDROID_API_KEY;
      if (!key) throw new EngineError('KINDROID_KEY_MISSING', 503);
      if (!/^[A-Za-z0-9_-]{8,160}$/.test(kinId)) throw new EngineError('KINDROID_ID_INVALID', 400);
      let response: Response;
      try {
        response = await queuedKindroidRequest(kinId, 10, () => request('https://api.kindroid.ai/v1/send-message', {
          method: 'POST',
          signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({
            ai_id: kinId,
            message: '[ECHO story interaction — visible story only, not a direct message. Based on your own personality and relationship, choose whether to simply view it, like it, or react. Reply with exactly one token: VIEW, LIKE, LAUGH, SURPRISE, or FIRE. Do not write a message; a separate private conversation handles story replies.]\n' + storyContext.slice(0, 800),
            stream: false,
          }),
        }), echoCharacterId);
      } catch (error) {
        throw new EngineError(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'KINDROID_TIMEOUT_RETRY_MANUALLY' : 'KINDROID_CONNECTION_RETRY_MANUALLY', 502);
      }
      if (!response.ok) {
        const category = await classifyKindroidFailure(response);
        console.warn('[kindroid] upstream rejected request', { situation: 'story_reaction', status: response.status, category });
        throw new EngineError(response.status === 429 ? 'KINDROID_RATE_LIMITED' : 'KINDROID_REQUEST_FAILED_RETRY_MANUALLY', response.status === 429 ? 429 : 502);
      }
      const raw = (await response.text()).trim();
      const choice = parseKindroidSocialChoice(raw, ['VIEW', 'LIKE', 'LAUGH', 'SURPRISE', 'FIRE']);
      if (!['VIEW', 'LIKE', 'LAUGH', 'SURPRISE', 'FIRE'].includes(choice)) throw new EngineError('KINDROID_SOCIAL_DECISION_INVALID', 502);
      const reaction = ({ LIKE: '❤', LAUGH: '😂', SURPRISE: '😮', FIRE: '🔥' } as Record<string, string>)[choice] ?? null;
      const decision = JSON.stringify({
        action: reaction ? 'react' : 'none', situation: 'story_reaction', text: null,
        reaction, reason: 'Kindroid story choice', suggestedDelayMinutes: 0,
        galleryPhotoId: null, contextSections: [],
      });
      input.validate?.(decision);
      return { text: decision, model: 'kindroid', usage: unknownUsage(), attempts: [] };
    },
  };
}

/** Kindroid is the sole decision-maker for founder feed likes. */
export function kindroidLikeDecisionProvider(
  kinId: string, situation: 'like_post' | 'like_comment', context: string,
  request: typeof fetch = fetch, echoCharacterId?: string,
): TextProvider {
  return {
    name: 'kindroid',
    async complete(input) {
      const key = process.env.ECHO_KINDROID_API_KEY;
      if (!key) throw new EngineError('KINDROID_KEY_MISSING', 503);
      if (!/^[A-Za-z0-9_-]{8,160}$/.test(kinId)) throw new EngineError('KINDROID_ID_INVALID', 400);
      let response: Response;
      try {
        response = await queuedKindroidRequest(kinId, 10, () => request('https://api.kindroid.ai/v1/send-message', {
          method: 'POST', signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ ai_id: kinId,
            message: `[ECHO feed interaction: Decide whether YOU would like this visible ${situation === 'like_post' ? 'post' : 'comment'} based on your own personality. Reply with exactly one token: LIKE or SKIP. This is not a private message.]\n${context.slice(0, 650)}`,
            stream: false }),
        }), echoCharacterId);
      } catch (error) {
        throw new EngineError(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'KINDROID_TIMEOUT_RETRY_MANUALLY' : 'KINDROID_CONNECTION_RETRY_MANUALLY', 502);
      }
      if (!response.ok) {
        throw new EngineError(response.status === 429 ? 'KINDROID_RATE_LIMITED' : 'KINDROID_REQUEST_FAILED_RETRY_MANUALLY', 502);
      }
      const raw = parseKindroidSocialChoice(await response.text(), ['LIKE', 'SKIP']);
      if (raw !== 'LIKE' && raw !== 'SKIP') throw new EngineError('KINDROID_SOCIAL_DECISION_INVALID', 502);
      const decision = JSON.stringify({ action: raw === 'LIKE' ? 'like' : 'none', situation,
        text: null, reaction: null, reason: 'Kindroid feed decision',
        suggestedDelayMinutes: 0, galleryPhotoId: null, contextSections: [] });
      input.validate?.(decision);
      return { text: decision, model: 'kindroid', usage: unknownUsage(), attempts: [] };
    },
  };
}

/**
 * Generate a peer-to-peer DM inside a dedicated Kindroid group, never in a
 * Kin's private /send-message history. The group owns its own context.
 * Streaming is essential: the non-streaming endpoint returns an empty body.
 */
export function kindroidPeerGroupProvider(groupId: string, kinId: string, echoCharacterId?: string, request: typeof fetch = fetch): TextProvider {
  return {
    name: 'kindroid',
    async complete(input) {
      const key = process.env.ECHO_KINDROID_API_KEY;
      if (!key) throw new EngineError('KINDROID_KEY_MISSING', 503);
      if (!/^[A-Za-z0-9_-]{8,160}$/.test(groupId) || !/^[A-Za-z0-9_-]{8,160}$/.test(kinId)) {
        throw new EngineError('KINDROID_GROUP_ID_INVALID', 400);
      }
      // Ask Kindroid which Kin owns the next turn before generating. A group
      // response must never be attributed to a different ECHO character.
      let turnResponse: Response;
      try {
        turnResponse = await queuedKindroidRequest(kinId, 30, () => request('https://api.kindroid.ai/v1/groupchats-get-turn', {
          method: 'POST',
          signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: groupId, allow_user: true }),
        }), echoCharacterId);
      } catch {
        throw new EngineError('KINDROID_GROUP_TURN_CONNECTION_FAILED', 502);
      }
      if (!turnResponse.ok) throw new EngineError('KINDROID_GROUP_TURN_FAILED', turnResponse.status === 429 ? 429 : 502);
      const nextKinId = (await turnResponse.text()).trim();
      if (!nextKinId) throw new EngineError('KINDROID_GROUP_USER_TURN', 409);
      if (nextKinId !== kinId) throw new EngineError('KINDROID_GROUP_SPEAKER_MISMATCH', 409);
      let response: Response;
      try {
        response = await queuedKindroidRequest(kinId, 30, () => request('https://api.kindroid.ai/v1/groupchats-ai-response', {
          method: 'POST',
          signal: AbortSignal.timeout(90000),
          headers: { Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' },
          body: JSON.stringify({ group_id: groupId, ai_id: kinId, stream: true }),
        }), echoCharacterId);
      } catch (error) {
        throw new EngineError(error instanceof Error && (error.name === 'TimeoutError' || error.name === 'AbortError')
          ? 'KINDROID_GROUP_TIMEOUT' : 'KINDROID_GROUP_CONNECTION_FAILED', 502);
      }
      if (!response.ok) {
        throw new EngineError(response.status === 429 ? 'KINDROID_RATE_LIMITED' : 'KINDROID_GROUP_REQUEST_FAILED', response.status === 429 ? 429 : 502);
      }
      const reply = (await response.text()).trim();
      if (!reply || reply.includes('<<ERROR>>') || reply.includes('<<HTTP_ERROR>>')) {
        throw new EngineError('KINDROID_GROUP_GENERATION_FAILED', 502);
      }
      const decision = JSON.stringify({
        action: 'draft', situation: 'dm', text: reply.slice(0, 8000),
        reason: 'Kindroid group conversation', suggestedDelayMinutes: 0,
        galleryPhotoId: null, reaction: null, contextSections: [],
      });
      input.validate?.(decision);
      return { text: decision, model: 'kindroid', usage: unknownUsage(), attempts: [] };
    },
  };
}
