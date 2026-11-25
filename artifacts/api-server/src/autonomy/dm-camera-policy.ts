/** Recognize a present-tense or completed first-person camera action in a reply. */
export function narratedCameraShot(reply: string): string | null {
  const action = /\bi\s+(?:(?:pull out|grab|lift|raise|hold up)\s+(?:my|the)\s+(?:phone|camera)\s+and\s+)?(?:(?:quickly|quietly|just)\s+)?(?:snap(?:ped)?|tak(?:e|ing)|took|captur(?:e|ed))\s+(?:(?:a|the|my|an|quick|little|new)\s+){0,4}(?:selfie|photo(?:graph)?|picture|snapshot)\b|\bme\s+(?:saco|saqué|tomo|tomé)\s+(?:(?:una|un|rápida|rápido)\s+){0,4}(?:selfie|foto|fotografía)\b|\b(?:saco|saqué|tomo|tomé)\s+(?:una|un)\s+(?:selfie|foto|fotografía)\b/iu;
  for (const line of reply.split(/\r?\n/)) {
    const candidate = line.trim().replace(/^\*+|\*+$/g, "").trim();
    const match = action.exec(candidate);
    if (!match || /^["“>]/.test(candidate) || /[?¿]/.test(candidate) ||
        /\b(?:yesterday|last (?:night|week|month|year)|ayer|anoche)\b/i.test(candidate) ||
        /\b(?:if|maybe|imagine|wish|remember|wanted|used to|should|could|might|si|quizás|imagino|ojalá|recuerdo)\b/i.test(candidate.slice(0, match.index))) continue;
    return candidate.slice(Math.max(0, match.index - 160), match.index + 420);
  }
  return null;
}
