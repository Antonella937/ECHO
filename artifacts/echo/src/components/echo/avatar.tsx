import { cn } from '@/lib/utils';
import { useMediaResolver } from '@/lib/media';
import type { Character } from '@/domain/types';
import { hasCharacterImage } from '../../lib/visual-defaults';
import { CharacterInitials } from './visual-defaults';
import { GracefulImage } from './graceful-image';

interface Props {
  character: Character;
  size?: number;
  ring?: 'unseen' | 'seen' | 'none' | 'close-friends';
  className?: string;
}

export function CharacterAvatar({ character, size = 36, ring = 'none', className }: Props) {
  const resolveScopedMedia = useMediaResolver();
  const resolveMedia = (ref: string) => resolveScopedMedia(ref,
    { sourceType: 'avatar', sourceContentId: character.id, sourceCharacterId: character.id });
  const src = hasCharacterImage(character.avatar) ? resolveMedia(character.avatar) : '';
  const img = src ? (
    <GracefulImage
      key={src}
      src={src}
      alt={character.name}
      width={size}
      height={size}
      loading={size >= 60 ? 'eager' : 'lazy'}
      draggable={false}
      containerClassName="rounded-full shrink-0"
      className="rounded-full object-cover"
      style={{ width: size, height: size }}
      fallback={<CharacterInitials name={character.name} size={size} />}
      data-testid={`img-avatar-${character.id}`}
    />
  ) : <CharacterInitials name={character.name} size={size} testId={`img-avatar-${character.id}`} />;
  if (ring === 'none') return <span className={cn('inline-flex shrink-0', className)}>{img}</span>;
  return (
    <span
      className={cn(
        'inline-flex shrink-0 rounded-full p-[2.5px]',
        ring === 'unseen' ? 'story-ring' : ring === 'close-friends' ? 'bg-primary' : 'bg-[hsl(240_4%_22%)]',
        className,
      )}
    >
      <span className="rounded-full bg-background p-[2.5px]">{img}</span>
    </span>
  );
}
