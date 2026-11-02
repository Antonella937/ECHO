/** Provider boundary: text in, text out. No social mutation capability. */
export interface TextProvider {
  readonly name: string;
  complete(input: { system: string; context: string; outputSchema: Record<string, unknown> }): Promise<{ text: string; model: string }>;
}

export class EngineError extends Error {
  constructor(public readonly code: string, public readonly status = 400) {
    super(code);
  }
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
