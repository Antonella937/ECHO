import { Fragment, type ReactNode } from 'react';
import { Link } from 'wouter';
import { useSocial } from '@/store/social-store';

const TOKEN = /(@[a-zA-Z0-9_][a-zA-Z0-9_.]{0,29}|#[\p{L}\p{N}_]{1,80})/gu;

/** Safe inline Markdown-like styling for dialogue and narration.
 * Supports ***bold italic***, **bold**, *italic*, __underline__, and <u>underline</u>.
 * User text is never inserted as HTML. */
function formatInline(source: string, renderPlain: (text: string, key: string) => ReactNode, prefix = 'f'): ReactNode[] {
  const pattern = /(\\*\\*\\*[\\s\\S]+?\\*\\*\\*|\\*\\*[\\s\\S]+?\\*\\*|\\*[\\s\\S]+?\\*|__[\\s\\S]+?__|<u>[\\s\\S]+?<\\/u>)/g;
  const output: ReactNode[] = [];
  let last = 0;
  for (const match of source.matchAll(pattern)) {
    const at = match.index ?? 0;
    if (at > last) output.push(renderPlain(source.slice(last, at), `${prefix}-${last}`));
    const token = match[0];
    const key = `${prefix}-${at}`;
    if (token.startsWith('***')) output.push(<strong key={key}><em>{formatInline(token.slice(3, -3), renderPlain, key)}</em></strong>);
    else if (token.startsWith('**')) output.push(<strong key={key}>{formatInline(token.slice(2, -2), renderPlain, key)}</strong>);
    else if (token.startsWith('*')) output.push(<em key={key}>{formatInline(token.slice(1, -1), renderPlain, key)}</em>);
    else if (token.startsWith('__')) output.push(<u key={key}>{formatInline(token.slice(2, -2), renderPlain, key)}</u>);
    else output.push(<u key={key}>{formatInline(token.slice(3, -4), renderPlain, key)}</u>);
    last = at + token.length;
  }
  if (last < source.length) output.push(renderPlain(source.slice(last), `${prefix}-${last}`));
  return output;
}

/** Renders text with clickable @mentions (existing accounts only) and #hashtags. */
export function SocialText({ text, className, onNavigate }: { text: string; className?: string; onNavigate?: () => void }) {
  const { state } = useSocial();
  const renderPlain = (plain: string, key: string): ReactNode => {
    const parts = plain.split(TOKEN);
    return <Fragment key={key}>{parts.map((part, i) => {
      if (i % 2 === 1) {
        const prev = parts[i - 1] ?? '';
        const boundary = !prev || /[^\\p{L}\\p{N}_]$/u.test(prev);
        if (boundary && part.startsWith('@')) {
          const handle = part.slice(1).replace(/\\.+$/, '');
          const acc = state.characters.find((c) => c.handle.toLowerCase() === handle.toLowerCase());
          if (acc) {
            const rest = part.slice(1 + handle.length);
            return <Fragment key={i}><Link href={`/profile/${acc.id}`} onClick={(e) => { e.stopPropagation(); onNavigate?.(); }} className="pointer-events-auto font-semibold text-primary hover:underline" data-testid={`link-mention-${acc.id}`}>@{handle}</Link>{rest}</Fragment>;
          }
        }
        if (boundary && part.startsWith('#')) {
          const tag = part.slice(1).toLocaleLowerCase();
          return <Link key={i} href={`/tags/${encodeURIComponent(tag)}`} onClick={(e) => { e.stopPropagation(); onNavigate?.(); }} className="pointer-events-auto font-medium text-primary hover:underline" data-testid={`link-hashtag-${tag}`}>{part}</Link>;
        }
      }
      return <Fragment key={i}>{part}</Fragment>;
    })}</Fragment>;
  };
  return (
    <span className={className}>{formatInline(text, renderPlain)}</span>
  );
}
