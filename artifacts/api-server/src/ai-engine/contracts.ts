import type { CharacterContextAudit } from '@workspace/api-zod';

/** Provider boundary: text in, text out. No social mutation capability. */
export interface TextProvider {
  readonly name: string;
  complete(input: { system: string; context: string; outputSchema: Record<string, unknown>; validate?: (text: string) => void }): Promise<{
    text: string; model: string; usage?: EngineUsage; attempts?: EngineAttempt[];
  }>;
}

export interface EngineUsage { promptTokens: number | null; completionTokens: number | null; cost: number | null }
export const decisionRejectionDiagnostics = [
  'SITUATION_MISMATCH',
  'NONE_TEXT_NOT_NULL',
  'DRAFT_TEXT_EMPTY',
  'DRAFT_TEXT_LIMIT_EXCEEDED',
  'CONTEXT_SECTION_UNAVAILABLE',
  'DUPLICATE_CONTEXT_SECTION',
  'FORBIDDEN_URL_OR_SECRET_PATTERN',
  'ACTION_NOT_ALLOWED_FOR_SITUATION',
  'NON_TEXT_ACTION_HAS_TEXT',
  'REACTION_REQUIRED',
  'REACTION_NOT_ALLOWED',
  'UNEXPECTED_REACTION',
] as const;
export type DecisionRejectionDiagnostic = typeof decisionRejectionDiagnostics[number];

export interface EngineAttempt {
  model: string;
  outcome: 'success' | 'failure' | 'skipped';
  code: string | null;
  usage: EngineUsage;
  /** Fixed safe reason code only; never provider text or prompts. */
  diagnostic?: DecisionRejectionDiagnostic;
}
export const unknownUsage = (): EngineUsage => ({ promptTokens: null, completionTokens: null, cost: null });

export class EngineError extends Error {
  attempts?: EngineAttempt[];
  contextAudit?: CharacterContextAudit;
  retryAfterMs?: number;
  constructor(public readonly code: string, public readonly status = 400, public readonly diagnostic?: DecisionRejectionDiagnostic) {
    super(code);
  }
}

/** Sanitized transport diagnostics only. Never attach a prompt or response body. */
export class ProviderFailure extends EngineError {
  constructor(code: string, status: number, public readonly retryable: boolean,
    public override readonly retryAfterMs = 0, public readonly usage = unknownUsage()) { super(code, status); }
}
export const sections = ['identity', 'personality', 'relationships', 'routine', 'social', 'memory', 'currentState', 'recentSocial'] as const;

export const decisionSchema: Record<string, unknown> = {
  type: 'object', additionalProperties: false,
  required: ['action', 'situation', 'text', 'reason', 'suggestedDelayMinutes', 'contextSections'],
  properties: {
    action: { type: 'string', enum: ['none', 'draft', 'like', 'react'] },
    situation: { type: 'string', enum: ['post', 'comment', 'dm', 'like_post', 'like_comment', 'story_reaction', 'dm_reaction'] },
    text: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    reason: { type: 'string', minLength: 1, maxLength: 400 },
    suggestedDelayMinutes: { type: 'integer', minimum: 0, maximum: 10080 },
    reaction: { anyOf: [{ type: 'string', maxLength: 32 }, { type: 'null' }] },
    // Uniqueness is enforced by the semantic validator so duplicates receive
    // a specific safe diagnostic rather than a generic schema rejection.
    contextSections: { type: 'array', maxItems: 8, items: { type: 'string', enum: sections } },
  },
};
