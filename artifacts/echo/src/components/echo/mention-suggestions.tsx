import { useSocial } from '@/store/social-store';
import { CharacterAvatar } from './avatar';
import { cn } from '@/lib/utils';

/** Suggests accounts while the trailing word is an @handle; picking completes it. */
export function MentionSuggestions({ text, onPick, excludeId, className }: { text: string; onPick(next: string): void; excludeId?: string; className?: string }) {
  const { state } = useSocial();
  const m = text.match(/(?:^|\s)@([a-zA-Z0-9_.]{0,30})$/);
  if (!m) return null;
  const q = m[1].toLowerCase();
  const list = state.characters
    .filter((c) => !c.archived && c.id !== excludeId && (c.handle.toLowerCase().includes(q) || c.name.toLowerCase().includes(q)))
    .slice(0, 5);
  if (!list.length) return null;
  return (
    <div role="listbox" aria-label="Mencionar cuenta" className={cn('no-scrollbar flex gap-1.5 overflow-x-auto', className)} data-testid="list-mention-suggestions">
      {list.map((c) => (
        <button key={c.id} type="button" role="option" aria-selected={false}
          onMouseDown={(e) => e.preventDefault()}
          onClick={() => onPick(text.slice(0, text.length - m[1].length) + c.handle + ' ')}
          className="flex h-10 shrink-0 items-center gap-2 rounded-full border border-border bg-card/90 pl-1 pr-3 text-xs font-semibold backdrop-blur"
          data-testid={`button-mention-suggest-${c.id}`}>
          <CharacterAvatar character={c} size={28} /> @{c.handle}
        </button>
      ))}
    </div>
  );
}
