/** Remove Kindroid's standalone transport delimiters and redundant self-labels.
 * Preserve mentions of other participants and normal prose.
 */
export function cleanGroupSpeakerPrefix(message: string, speakerName: string): string {
  const name = speakerName.trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const ownLabel = name
    ? new RegExp("^(?:\\s*\\[" + escaped + "\\]\\s*|\\s*" + escaped + ":\\s*)", "i")
    : null;
  const marker = /^\s*(?:(?:<<|\[|<)\s*)?(?:start|end)[ _-]*message\s*(?:(?:>>|\]|>))?\s*:?\s*$/i;
  return message.split("\n")
    .filter(line => !marker.test(line))
    .map(line => ownLabel ? line.replace(ownLabel, "") : line)
    .join("\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim();
}
