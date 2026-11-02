import type { CharacterContextAudit } from '@workspace/api-zod';

/** Provider boundary: text in, text out. No social mutation capability. */
export interface TextProvider {
  readonly name: string;
  complete(input: { system: string; context: string; outputSchema: Record<string, unknown>; validate?: (text: string) => void }): Promise<{
    text: string; model: string; usage?: EngineUsage; attempts?: EngineAttempt[];
  }>;
}

export interface EngineUsage { promptTokens: number | null; completionTokens: number | null; cost: number | null }
export interface EngineAttempt { model: string; outcome: 'success' | 'failure' | 'skipped'; code: string | null; usage: EngineUsage }
export const unknownUsage = (): EngineUsage => ({ promptTokens: null, completionTokens: null, cost: null });

export class EngineError extends Error {
  attempts?: EngineAttempt[];
  contextAudit?: CharacterContextAudit;
  retryAfterMs?: number;
  constructor(public readonly code: string, public readonly status = 400) {
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
    action: { type: 'string', enum: ['none', 'draft'] },
    situation: { type: 'string', enum: ['post', 'comment', 'dm'] },
    text: { anyOf: [{ type: 'string', maxLength: 2000 }, { type: 'null' }] },
    reason: { type: 'string', minLength: 1, maxLength: 400 },
    suggestedDelayMinutes: { type: 'integer', minimum: 0, maximum: 10080 },
    contextSections: { type: 'array', maxItems: 8, uniqueItems: true, items: { type: 'string', enum: sections } },
  },
};
