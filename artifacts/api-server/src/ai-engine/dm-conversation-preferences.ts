/** Conversation-specific prompt guidance. This is intentionally pure and never writes memories. */
export type ConversationStyle = "natural" | "narrative" | "mixed";
export type ResponseTiming = "realistic" | "instant";
export type ResponseLength = "short" | "balanced" | "detailed";
export interface DmConversationPreferences {
  style: ConversationStyle;
  responseTiming: ResponseTiming;
  responseLength: ResponseLength;
  autonomousInitiative: boolean;
}
export const DEFAULT_DM_CONVERSATION_PREFERENCES: Readonly<DmConversationPreferences> = Object.freeze({
  style: "natural", responseTiming: "realistic", responseLength: "balanced", autonomousInitiative: true,
});
/** Validate untrusted settings; do not let arbitrary user content become system instructions. */
export function parseDmConversationPreferences(value: unknown): DmConversationPreferences {
  if (!value || typeof value !== "object" || Array.isArray(value)) throw new Error("INVALID_DM_PREFERENCES");
  const v = value as Record<string, unknown>;
  if (!["natural", "narrative", "mixed"].includes(String(v.style)) ||
      !["realistic", "instant"].includes(String(v.responseTiming)) ||
      !["short", "balanced", "detailed"].includes(String(v.responseLength)) ||
      typeof v.autonomousInitiative !== "boolean") throw new Error("INVALID_DM_PREFERENCES");
  return {
    style: v.style as ConversationStyle,
    responseTiming: v.responseTiming as ResponseTiming,
    responseLength: v.responseLength as ResponseLength,
    autonomousInitiative: v.autonomousInitiative,
  };
}
/** Append to an existing, higher-priority persona prompt; never replace identity or safety rules. */
export function dmConversationStyleInstructions(settings: DmConversationPreferences): string {
  const style = {
    natural: "Write as a real person texting in a social network. Do not narrate gestures or actions unless asked.",
    narrative: "Continue collaborative roleplay with character actions and spoken dialogue. Interpret user actions between asterisks. Never narrate the user's choices or private thoughts.",
    mixed: "Default to natural texting. When the user initiates a narrated scene or action, respond in collaborative roleplay format.",
  }[settings.style];
  const length = {
    short: "Prefer concise replies.",
    balanced: "Use moderate reply length appropriate to context.",
    detailed: "Use more detail when it serves the scene; avoid repetition.",
  }[settings.responseLength];
  const timing = settings.responseTiming === "instant" ? "For this DM, set suggestedDelayMinutes to 0; do not add an artificial delay." : "For this DM, choose a plausible suggestedDelayMinutes based on the character\u0027s routine and context; do not force a delay when a prompt reply makes sense.";
  return [style, length, timing, "For adult characters in an explicitly consensual romantic relationship, allow natural affectionate and sensual non-graphic narration when the scene calls for it. Keep the tone tasteful and character-specific; avoid explicit sexual acts, graphic anatomical descriptions, or vulgar escalation. When intimacy would become explicit, transition discreetly (fade to black) without abruptly breaking the scene. Never initiate sexual content autonomously, never override platonic friend/family presets, and respect consent, boundaries and age restrictions.", "Keep the established personality, memories, language, relationships, and privacy boundaries. Do not assume any unseen private messages are known."].join("\n");
}
/** Scheduling is separate from writing style: immediate means no artificial delay, not zero model latency. */
export function shouldDelayDmReply(settings: DmConversationPreferences): boolean {
  return settings.responseTiming === "realistic";
}
