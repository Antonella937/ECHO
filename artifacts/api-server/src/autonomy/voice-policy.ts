/** Voice delivery selection for ECHO autonomous direct messages.
 * This module never calls a paid provider or changes stored messages.
 * Only enable actual delivery after private TTS and owner budgets are wired.
 */
export type VoiceDelivery = "text" | "voice";
export type VoicePreference = "off" | "occasional" | "frequent";

export interface VoiceDecisionInput {
  /** Character's configured voice, either a basic preset or a verified provider voice. */
  voiceId?: string | null;
  /** Owner has opted in to autonomous voice generation and accepted a budget. */
  ownerEnabled: boolean;
  /** Provider and private media pipeline are operational. */
  engineReady: boolean;
  /** Explicit request in the latest incoming DM. This is never authorization by itself. */
  requestedVoice?: boolean;
  /** Character's preferred frequency of spontaneous voice notes. */
  preference?: VoicePreference;
  /** Successful voice messages already sent by this character today. */
  voiceMessagesToday: number;
  maxVoiceMessagesPerDay: number;
  /** Provider usage budget remaining, in normalized billable characters. */
  remainingCharacters: number;
  messageLength: number;
  fitsConversation?: boolean;
  random?: () => number;
}

export function chooseVoiceDelivery(input: VoiceDecisionInput): VoiceDelivery {
  if (!input.ownerEnabled || !input.engineReady || !input.voiceId ||
    input.voiceMessagesToday >= input.maxVoiceMessagesPerDay ||
    input.messageLength < 1 || input.messageLength > 500 ||
    input.remainingCharacters < input.messageLength) return "text";
  // A request from any DM participant does not override the owner-controlled policy.
  if (input.requestedVoice && input.preference !== "off") return "voice";
  if (!input.fitsConversation) return "text";
  const chance = input.preference === "frequent" ? 0.28 : input.preference === "occasional" ? 0.1 : 0;
  const draw = input.random?.() ?? Math.random();
  return draw >= 0 && draw < chance ? "voice" : "text";
}

/** Request classification is advisory only; a user's DM is not a command to bypass billing. */
export function isExplicitVoiceRequest(text: string): boolean {
  const normalized = text.toLocaleLowerCase().trim();
  return /(?:nota de voz|mensaje de voz|audio|voice (?:note|message))/.test(normalized) &&
    /(?:mand[aáe]|envi[aáe]|respond[eéa]|contest[aáe]|grab[aáe]|send|reply|record)/.test(normalized);
}

/** Read only spoken dialogue. Asterisks and underscores mark roleplay narration. */
export function getSpokenVoiceText(text: string): string {
  if (/https?:\/\/|`|\[(?:ECHO|Transcripción)/i.test(text)) return "";
  const dialogue = text.replace(/\*{1,2}[^*]+\*{1,2}|(?<!\w)_[^_]+_(?!\w)/g, " ")
    .replace(/\s+/g, " ").trim();
  return /\p{L}/u.test(dialogue) ? dialogue : "";
}

/** A short voice note fits affectionate, reassuring, or voice-related moments. */
export function fitsVoiceConversation(incoming: string, dialogue: string): boolean {
  return /\b(?:hear (?:your|my) voice|miss (?:you|your voice)|good ?night|good morning|sweet dreams|i(?:'|’)m here|i promise|can(?:'|’)t wait|thinking (?:of|about) you|te extraño|buenas noches|buen día|estoy acá|te prometo|quiero escucharte)\b|[🖤❤️]/iu
    .test(incoming + " " + dialogue);
}
