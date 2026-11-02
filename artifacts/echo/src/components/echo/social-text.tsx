import { Fragment } from 'react';
import { Link } from 'wouter';
import { useSocial } from '@/store/social-store';

const TOKEN = /(@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,29}|#[\p{L}\p{N}_]{1,80})/gu;

/** Renders text with clickable @mentions (existing accounts only) and #hashtags. */
export function SocialText({ text, className }: { text: string; className?: string }) {
  const { state } = useSocial();
  const parts = text.split(TOKEN);
  return (
    <span className={className}>
      {parts.map((part, i) => {
        if (i % 2 === 1) {
          const prev = parts[i - 1] ?? '';
          const boundary = !prev || /[^\p{L}\p{N}_]$/u.test(prev);
          if (boundary && part.startsWith('@')) {
            const handle = part.slice(1).replace(/\.+$/, '');
            const acc = state.characters.find((c) => c.handle.toLowerCase() === handle.toLowerCase());
            if (acc) {
              const rest = part.slice(1 + handle.length);
              return (
                <Fragment key={i}>
                  <Link href={`/profile/${acc.id}`} onClick={(e) => e.stopPropagation()} className="pointer-events-auto font-semibold text-primary hover:underline" data-testid={`link-mention-${acc.id}`}>@{handle}</Link>{rest}
                </Fragment>
              );
            }
          }
          if (boundary && part.startsWith('#')) {
            const tag = part.slice(1).toLocaleLowerCase();
            return (
              <Link key={i} href={`/tags/${encodeURIComponent(tag)}`} onClick={(e) => e.stopPropagation()} className="pointer-events-auto font-medium text-primary hover:underline" data-testid={`link-hashtag-${tag}`}>{part}</Link>
            );
          }
        }
        return <Fragment key={i}>{part}</Fragment>;
      })}
    </span>
  );
}
