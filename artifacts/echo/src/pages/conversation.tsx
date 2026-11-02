import { VerifiedBadge } from '@/components/echo/verified-badge';
import { useEffect, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'wouter';
import { ChevronLeft, Send } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { useThreadMessages } from '@/hooks/use-social-selectors';
import { CharacterAvatar } from '@/components/echo/avatar';
import { EmptyState } from '@/components/echo/skeletons';
import { useBack } from '@/components/echo/top-bar';
import { resolveMedia, timeAgo } from '@/lib/media';
import { cn } from '@/lib/utils';
import type { Message } from '@/domain/types';

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { me, character, actions, state } = useSocial();
  const other = character(id);
  const messages = useThreadMessages(id);
  const back = useBack();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const unreadCount = messages.filter((m) => m.recipientId === me.id && !m.readBy.includes(me.id)).length;

  useEffect(() => {
    if (unreadCount > 0) actions.markThreadRead(id);
  }, [unreadCount, id, actions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  if (!other || other.id === me.id)
    return <EmptyState title="Conversación no disponible" body="No puedes escribirte a ti mismo, aunque a veces apetezca." />;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!text.trim()) return;
    actions.sendMessage(other.id, text);
    setText('');
  };

  return (
    <div className="flex min-h-[100dvh] flex-col">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 pt-safe backdrop-blur-xl">
        <div className="flex h-16 items-center gap-2 px-2">
          <button onClick={back} aria-label="Volver" className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary" data-testid="button-back">
            <ChevronLeft className="h-6 w-6" strokeWidth={1.6} />
          </button>
          <Link href={`/profile/${other.id}`} className="flex min-w-0 items-center gap-3" data-testid="link-conversation-profile">
            <CharacterAvatar character={other} size={38} />
            <div className="min-w-0 leading-tight">
              <div className="flex items-center gap-1 truncate text-[15px] font-semibold">{other.name}<VerifiedBadge account={other} className="h-3.5 w-3.5" /></div>
              <div className="truncate text-xs text-muted-foreground">@{other.handle}</div>
            </div>
          </Link>
        </div>
      </header>

      <div className="flex-1 px-4 pb-4 pt-6">
        <div className="mb-8 flex flex-col items-center text-center">
          <CharacterAvatar character={other} size={72} />
          <div className="mt-3 inline-flex items-center gap-1.5 font-display text-lg">{other.name}<VerifiedBadge account={other} /></div>
          <div className="text-xs text-muted-foreground">{other.occupation} · {other.location}</div>
        </div>
        {messages.length === 0 && <p className="text-center text-sm text-muted-foreground">Todavía no os habéis escrito.</p>}
        <ul className="flex flex-col gap-1.5">
          {messages.map((m, i) => (
            <Bubble key={m.id} m={m} mine={m.senderId === me.id} showTime={i === 0 || new Date(m.createdAt).getTime() - new Date(messages[i - 1].createdAt).getTime() > 3 * 3600_000} state={state} />
          ))}
        </ul>
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-0 border-t border-border/60 bg-background/90 px-3 pb-safe pt-2 backdrop-blur-xl">
        <div className="flex items-center gap-2 pb-1">
          <CharacterAvatar character={me} size={32} />
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            placeholder={`Escribir como ${me.name.split(' ')[0]}…`}
            className="h-12 min-w-0 flex-1 rounded-full border border-input bg-card px-5 text-[15px] placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
            aria-label="Mensaje"
            data-testid="input-message"
          />
          <button type="submit" disabled={!text.trim()} aria-label="Enviar" className="tap grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-35" data-testid="button-send-message">
            <Send className="h-5 w-5" strokeWidth={1.8} />
          </button>
        </div>
      </form>
    </div>
  );
}

function Bubble({ m, mine, showTime, state }: { m: Message; mine: boolean; showTime: boolean; state: ReturnType<typeof useSocial>['state'] }) {
  const story = m.storyId ? state.stories.find((s) => s.id === m.storyId) : undefined;
  const post = m.postId ? state.posts.find((p) => p.id === m.postId) : undefined;
  return (
    <li className={cn('fade-up flex flex-col', mine ? 'items-end' : 'items-start')} data-testid={`message-${m.id}`}>
      {showTime && <span className="my-3 self-center text-[11px] text-muted-foreground">{timeAgo(m.createdAt)}</span>}
      {m.storyId && (
        <div className={cn('mb-1 flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
          <span className="text-[11px] text-muted-foreground">{mine ? 'Respondiste a su historia' : 'Respondió a tu historia'}</span>
          {story ? (
            <img src={resolveMedia(story.image)} alt="Historia" className="h-36 w-24 rounded-xl object-cover opacity-90" />
          ) : (
            <span className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">Historia no disponible</span>
          )}
        </div>
      )}
      {post && (
        <Link href={`/p/${post.id}`} className="mb-1 block w-48 overflow-hidden rounded-2xl border border-border bg-card" data-testid={`link-shared-post-${m.id}`}>
          <img src={resolveMedia(post.image)} alt="" className="aspect-[4/5] w-full object-cover" />
          <p className="truncate px-3 py-2 text-xs text-muted-foreground">{post.caption}</p>
        </Link>
      )}
      <p
        className={cn(
          'max-w-[78%] whitespace-pre-wrap break-words rounded-[22px] px-4 py-2.5 text-[15px] leading-snug',
          mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-secondary text-foreground',
        )}
      >
        {m.text}
      </p>
    </li>
  );
}
