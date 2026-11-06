import type { MessageAttachment } from '@/domain/types';
import { MediaScopeContext, retryPrivateMedia, useMediaResolver } from '@/lib/media';
import { mediaSourceFor } from '@/lib/media-source';
import { useContext } from 'react';
import { AudioMessagePlayer } from './audio-message-player';

export function AttachmentView({ a, mine, messageId }: { a: MessageAttachment; mine: boolean; messageId?: string }) {
  const resolveMedia = useMediaResolver();
  const scope = useContext(MediaScopeContext);
  const hint = messageId ? { sourceType: 'message' as const, sourceContentId: messageId } : undefined;
  const src = resolveMedia(a.url, hint);
  if (a.type === 'image')
    return <img src={src} alt="Foto adjunta" loading="lazy" className="max-h-72 w-56 rounded-2xl border border-border object-cover" data-testid={`img-attachment-${a.id}`} />;
  if (a.type === 'video')
    return <video src={src} controls playsInline preload="metadata" className="max-h-80 w-60 rounded-2xl border border-border bg-card" data-testid={`video-attachment-${a.id}`} />;
  return <AudioMessagePlayer src={src} mine={mine} durationSeconds={a.durationSeconds} attachmentId={a.id}
    onRetry={() => retryPrivateMedia(a.url, mediaSourceFor(scope, a.url, hint))} />;
}
