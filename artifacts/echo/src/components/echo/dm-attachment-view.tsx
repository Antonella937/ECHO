import type { MessageAttachment } from '@/domain/types';
import { retryPrivateMedia, useMediaResolver } from '@/lib/media';
import { AudioMessagePlayer } from './audio-message-player';

export function AttachmentView({ a, mine, messageId }: { a: MessageAttachment; mine: boolean; messageId?: string }) {
  const resolveMedia = useMediaResolver();
  const src = resolveMedia(a.url, messageId ? { sourceType: 'message', sourceContentId: messageId } : undefined);
  if (a.type === 'image')
    return <img src={src} alt="Foto adjunta" loading="lazy" className="max-h-72 w-56 rounded-2xl border border-border object-cover" data-testid={`img-attachment-${a.id}`} />;
  if (a.type === 'video')
    return <video src={src} controls playsInline preload="metadata" className="max-h-80 w-60 rounded-2xl border border-border bg-card" data-testid={`video-attachment-${a.id}`} />;
  return <AudioMessagePlayer src={src} mine={mine} durationSeconds={a.durationSeconds} attachmentId={a.id}
    onRetry={() => retryPrivateMedia(a.url)} />;
}
