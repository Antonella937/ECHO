/** Strip only redundant self-attribution from a group message.
 * Never remove another participant's label or rewrite message content.
 */
export function cleanGroupSpeakerPrefix(message: string, speakerName: string): string {
  const name = speakerName.trim();
  const withoutMarkers = message.split("\n").filter(line => !/^\\s*(?:[<\\[]\\s*)?(?:start|end)[ _-]*message(?:\\s*[>\\]])?\\s*:?\\s*$/i.test(line)).join("\n");
  if (!name) return withoutMarkers.trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp("^(?:\\s*\\[" + escaped + "\\]\\s*|\\s*" + escaped + ":\\s*)", "i");
  return withoutMarkers.split("\n").map(line => line.replace(prefix, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}
