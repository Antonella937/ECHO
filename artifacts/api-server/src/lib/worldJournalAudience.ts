export type JournalAudience = {
  category: 'world_knowledge' | 'shared_memory' | 'secret';
  knowledgeScope: 'everyone' | 'selected' | 'nobody';
  knownCharacterIds: string[];
};

/** Validation shared by manual edits and AI proposals. Never make a secret public. */
export function validJournalAudience(entry: JournalAudience, activeCharacterIds: readonly string[]) {
  const selected = entry.knownCharacterIds;
  const allowed = new Set(activeCharacterIds);
  return selected.length === new Set(selected).size
    && selected.every(id => allowed.has(id))
    && (entry.knowledgeScope === 'selected' ? selected.length > 0 : selected.length === 0)
    && !(entry.category === 'secret' && entry.knowledgeScope === 'everyone');
}
