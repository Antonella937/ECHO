/** Strip only redundant self-attribution from a group message.
 * Never remove another participant's label or rewrite message content.
 */
export function cleanGroupSpeakerPrefix(message: string, speakerName: string): string {
  const name = speakerName.trim();
  if (!name) return message.trim();
  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  const prefix = new RegExp("^(?:\\s*\\[" + escaped + "\\]\\s*|\\s*" + escaped + ":\\s*)", "i");
  return message.split("\n").map(line => line.replace(prefix, "")).join("\n")
    .replace(/\n{3,}/g, "\n\n").trim();
}
