import type { SocialState } from "@workspace/api-zod";
import { recordAutonomyEvent } from "../autonomy/event-memory";

/**
 * Capture new, user-initiated conversations addressed to configured characters.
 * Compare against the previously saved owner/universe snapshot; never derive
 * memories from edits, historical imports or hidden/private unrelated threads.
 * This runs before the same revision-checked universe write.
 */
export function recordIncomingConversationEvents(previous: SocialState, incoming: SocialState): SocialState {
  const previousIds = new Set(previous.messages.map(message => message.id));
  const knownCharacters = new Set(previous.characters.filter(c => !c.archived).map(c => c.id));
  let next = incoming;
  for (const message of incoming.messages) {
    if (previousIds.has(message.id) || message.origin === "autonomy" ||
      !knownCharacters.has(message.recipientId) ||
      !knownCharacters.has(message.senderId) ||
      message.senderId === message.recipientId ||
      message.hiddenForIds?.includes(message.recipientId)) continue;
    const recipient = next.characters.find(c => c.id === message.recipientId);
    if (!recipient?.configuration) continue;
    const sender = next.characters.find(c => c.id === message.senderId);
    if (!sender) continue;
    // Remember only the direct recipient's own conversation; never distribute
    // private messages to unrelated characters.
    next = recordAutonomyEvent(next, message.recipientId, {
      sourceId: message.id,
      kind: "conversation",
      text: `Mensaje recibido de ${sender.name}: ${message.text}`,
      targetId: message.senderId,
    }, new Date(message.createdAt));
  }
  return next;
}
