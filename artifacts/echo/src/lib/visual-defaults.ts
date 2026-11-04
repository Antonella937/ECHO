/** Only the legacy placeholder counts as missing. Never replace uploaded or bundled portraits. */
export function hasCharacterImage(ref: string | null | undefined): boolean {
  return Boolean(ref?.trim() && ref.trim() !== 'asset:account-default');
}

export function characterInitials(name: string): string {
  const words = name.normalize('NFC').trim().split(/\s+/u).filter(Boolean);
  if (!words.length) return '?';
  const first = (word: string) => {
    const grapheme = typeof Intl.Segmenter === 'function'
      ? [...new Intl.Segmenter(undefined, { granularity: 'grapheme' }).segment(word)][0]?.segment
      : Array.from(word)[0];
    return grapheme ?? '';
  };
  return [first(words[0]), ...(words.length > 1 ? [first(words[words.length - 1])] : [])]
    .join('').toLocaleUpperCase();
}

/** Session identity belongs in cache keys, not a caller-supplied ownerId API parameter. */
export function ownerScopedPreviewKey(base: readonly unknown[], ownerId: string | undefined) {
  return [...base, { privatePreviewOwner: ownerId ?? null }];
}
