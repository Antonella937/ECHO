import { VerifiedBadge } from './verified-badge';
import { Plus } from 'lucide-react';
import { useLocation } from 'wouter';
import { useSocial } from '@/store/social-store';
import { useStoryGroups } from '@/hooks/use-social-selectors';
import { CharacterAvatar } from './avatar';
import { useStoryViewer } from './story-viewer';

export function StoryRail() {
  const { me } = useSocial();
  const groups = useStoryGroups();
  const { openStories } = useStoryViewer();
  const [, navigate] = useLocation();
  const mine = groups.find((g) => g.author.id === me.id);
  const others = groups.filter((g) => g.author.id !== me.id);

  return (
    <section aria-label="Historias" className="no-scrollbar flex gap-4 overflow-x-auto px-4 pb-4 pt-1">
      <div className="flex w-[74px] shrink-0 flex-col items-center gap-1.5">
        <div className="relative">
          <button
            onClick={() => (mine ? openStories(me.id) : navigate('/create?mode=story'))}
            className="tap rounded-full"
            aria-label={mine ? 'Ver tu historia' : 'Crear historia'}
            data-testid="button-story-own"
          >
            <CharacterAvatar character={me} size={66} ring={mine ? (mine.stories.some(s => s.closeFriendsOnly) ? 'close-friends' : 'seen') : 'none'} className={mine ? '' : 'p-[5px]'} />
          </button>
          <button
            onClick={() => navigate('/create?mode=story')}
            aria-label="Añadir a tu historia"
            className="tap absolute -bottom-0.5 -right-0.5 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground ring-[3px] ring-background"
            data-testid="button-story-add"
          >
            <Plus className="h-3.5 w-3.5" strokeWidth={2.6} />
          </button>
        </div>
        <span className="w-full truncate text-center text-[11.5px] text-muted-foreground">Tu historia</span>
      </div>

      {others.map((g) => (
        <button
          key={g.author.id}
          onClick={() => openStories(g.author.id)}
          className="tap flex w-[74px] shrink-0 flex-col items-center gap-1.5"
          data-testid={`button-story-${g.author.id}`}
        >
          <CharacterAvatar character={g.author} size={66} ring={g.stories.some(s => s.closeFriendsOnly) ? 'close-friends' : (g.allSeen ? 'seen' : 'unseen')} />
          <span className={`w-full truncate text-center text-[11.5px] ${g.allSeen ? 'text-muted-foreground' : 'text-foreground'}`}>
            {g.author.name.split(' ')[0].toLowerCase()}<VerifiedBadge account={g.author} className="ml-0.5 h-3 w-3 align-[-1px]" />
          </span>
        </button>
      ))}
    </section>
  );
}
