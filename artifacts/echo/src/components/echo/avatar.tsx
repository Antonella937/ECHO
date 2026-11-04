import { cn } from '@/lib/utils';
import { useMediaResolver } from '@/lib/media';
import type { Character } from '@/domain/types';
import { hasCharacterImage } from '../../lib/visual-defaults';
import { CharacterInitials } from './visual-defaults';

interface Props {
  character: Character;
  size?: number;
  ring?: 'unseen' | 'seen' | 'none';
  className?: string;
}

export function CharacterAvatar({ character, size = 36, ring = 'none', className }: Props) {
  const resolveScopedMedia = useMediaResolver();
  const resolveMedia = (ref: string) => resolveScopedMedia(ref,
    { sourceType: 'avatar', sourceContentId: character.id, sourceCharacterId: character.id });
  const img = hasCharacterImage(character.avatar) ? (
    <img
      src={resolveMedia(character.avatar)}
      alt={character.name}
      width={size}
      height={size}
      loading="lazy"
      draggable={false}
      className="rounded-full object-cover bg-muted"
      style={{ width: size, height: size }}
      data-testid={`img-avatar-${character.id}`}
    />
  ) : <CharacterInitials name={character.name} size={size} testId={`img-avatar-${character.id}`} />;
  if (ring === 'none') return <span className={cn('inline-flex shrink-0', className)}>{img}</span>;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-full p-[2.5px]',
        ring === 'unseen' ? 'story-ring' : 'bg-[hsl(240_4%_22%)]',
        className,
      )}
    >
      <span className="rounded-full bg-background p-[2.5px]">{img}</span>
    </span>
  );
}
