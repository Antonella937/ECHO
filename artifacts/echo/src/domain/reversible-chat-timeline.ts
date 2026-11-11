/**
 * Non-destructive chat timeline primitives.
 *
 * This is a pure, local building block. A production rewind must persist its
 * active cursor server-side, scope it to an authenticated universe/thread,
 * and invalidate or rebuild derived AI memory before allowing continuation.
 * Never delete source messages to rewind.
 */
export interface TimelineMessage {
  id: string;
  createdAt: string;
}

export interface RewindCheckpoint {
  /** Last message that remains visible in the active timeline. */
  throughMessageId: string;
  /** Immutable message IDs hidden from the active timeline, in original order. */
  hiddenMessageIds: string[];
}

/** Stable order; no mutation of the original message collection. */
export function rewindTimeline<T extends TimelineMessage>(
  messages: readonly T[],
  throughMessageId: string,
): { visible: T[]; checkpoint: RewindCheckpoint } {
  const index = messages.findIndex(message => message.id === throughMessageId);
  if (index < 0) throw new Error('REWIND_MESSAGE_NOT_FOUND');
  return {
    visible: messages.slice(0, index + 1),
    checkpoint: {
      throughMessageId,
      hiddenMessageIds: messages.slice(index + 1).map(message => message.id),
    },
  };
}

/**
 * Recover only messages that belonged to the checkpoint.
 * Newly generated messages after rewind are NOT silently merged into the old
 * history: the caller must explicitly choose which branch to keep.
 */
export function restoreTimeline<T extends TimelineMessage>(
  originalMessages: readonly T[],
  checkpoint: RewindCheckpoint,
): T[] {
  const allowed = new Set([checkpoint.throughMessageId, ...checkpoint.hiddenMessageIds]);
  const anchorIndex = originalMessages.findIndex(message => message.id === checkpoint.throughMessageId);
  if (anchorIndex < 0) throw new Error('RESTORE_ANCHOR_NOT_FOUND');
  const restored = originalMessages.slice(0, anchorIndex + 1);
  const suffix = originalMessages.slice(anchorIndex + 1).filter(message => allowed.has(message.id));
  if (suffix.length !== checkpoint.hiddenMessageIds.length ||
      suffix.some((message, index) => message.id !== checkpoint.hiddenMessageIds[index])) {
    throw new Error('RESTORE_HISTORY_CHANGED');
  }
  return [...restored, ...suffix];
}
