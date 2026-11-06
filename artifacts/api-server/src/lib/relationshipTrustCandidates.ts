import type { SocialState } from "@workspace/api-zod";
import type { TrustEventKind } from "./relationshipTrust";

/**
 * Suggests reviewable evidence only. No candidate is a verified event.
 * Explicit statements can still be fiction, sarcasm or mistaken; an owner
 * must review them before the approval endpoint may change trust.
 */
const PATTERNS: { kind: TrustEventKind; patterns: RegExp[] }[] = [
  { kind: "promise_kept", patterns: [/\b(?:cumpl[ií] (?:mi|la) promesa|i kept my promise)\b/i] },
  { kind: "support_given", patterns: [/\b(?:gracias por apoyarme|thank you for supporting me|gracias por estar conmigo)\b/i] },
  { kind: "boundary_respected", patterns: [/\b(?:gracias por respetar mi (?:l[ií]mite|decisi[oó]n)|thank you for respecting my boundary)\b/i] },
  { kind: "lie_confirmed", patterns: [/\b(?:te ment[ií]|i lied to you)\b/i] },
  { kind: "promise_broken", patterns: [/\b(?:romp[ií] (?:mi|la) promesa|i broke my promise)\b/i] },
  { kind: "betrayal_confirmed", patterns: [/\b(?:te traicion[eé]|i betrayed you)\b/i] },
  { kind: "repair_confirmed", patterns: [/\b(?:te pido perd[oó]n y quiero reparar|i want to make amends)\b/i] },
];

/**
 * Conservative contextual screening. Quoted, hypothetical, negated or
 * explicitly joking statements are not suitable for automatic suggestions.
 * This is deterministic triage, NOT an LLM truth judgment.
 */
export function screenTrustEvidence(text: string): { eligible: boolean; reason: string } {
  const normalized = text.normalize("NFC").trim();
  if (!normalized || normalized.length > 6000) return { eligible: false, reason: "EMPTY_OR_OVERSIZED" };
  if (/(?:^|[.!?\\n]\\s*)(?:si|if|imagina|imagine|supongamos|what if)\\b/i.test(normalized) ||
      /\\b(?:habr[ií]a|hubiera|would have|could have|hypothetically|en teor[ií]a)\\b/i.test(normalized)) {
    return { eligible: false, reason: "HYPOTHETICAL" };
  }
  if (/\\b(?:es broma|era broma|just kidding|i'm joking|jajaja|lol|mentira,? era broma)\\b/i.test(normalized)) {
    return { eligible: false, reason: "JOKE_OR_RETRACTION" };
  }
  if (/\\b(?:no te ment[ií]|nunca te ment[ií]|i didn't lie|i never lied|no te traicion[eé]|i didn't betray)\\b/i.test(normalized)) {
    return { eligible: false, reason: "NEGATED" };
  }
  if (/^(?:[>“"']|dijo:|she said:|he said:)/i.test(normalized)) {
    return { eligible: false, reason: "QUOTED_OR_REPORTED" };
  }
  return { eligible: true, reason: "REVIEW_REQUIRED" };
}

export function suggestTrustCandidates(
  state: SocialState, actorId: string, targetId: string,
  consumedSourceIds: readonly string[], now = new Date(),
) {
  const actor = state.characters.find(c => c.id === actorId && !c.archived);
  const target = state.characters.find(c => c.id === targetId && !c.archived);
  if (!actor?.configuration?.relationships.some(r => r.targetId === targetId) || !target) return [];
  const cutoff = now.getTime() - 30 * 24 * 60 * 60_000;
  return state.messages.filter(m => {
    const at = new Date(m.createdAt).getTime();
    return at >= cutoff && at <= now.getTime() &&
      !m.hiddenForIds?.includes(actorId) &&
      ((m.senderId === actorId && m.recipientId === targetId) ||
       (m.senderId === targetId && m.recipientId === actorId)) &&
      !consumedSourceIds.includes(`trust:${m.id}`);
  }).flatMap(m => {
    const screen = screenTrustEvidence(m.text);
    if (!screen.eligible) return [];
    const matched = PATTERNS.find(p => p.patterns.some(pattern => pattern.test(m.text)));
    return matched ? [{
      sourceId: m.id, actorId, targetId, kind: matched.kind,
      excerpt: m.text.slice(0, 280), occurredAt: m.createdAt,
      status: "needs_owner_review" as const, verified: false as const,
    }] : [];
  }).slice(-20);
}
