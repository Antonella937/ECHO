import type { MessageAttachment } from '@/domain/types';
import { resolveMedia } from '@/lib/media';
import { formatDuration } from '@/lib/dm-attachments';
import { cn } from '@/lib/utils';

export function AttachmentView({ a, mine }: { a: MessageAttachment; mine: boolean }) {
  const src = resolveMedia(a.url);
  if (a.type === 'image')
    return <img src={src} alt="Foto adjunta" loading="lazy" className="max-h-72 w-56 rounded-2xl border border-border object-cover" data-testid={`img-attachment-${a.id}`} />;
  if (a.type === 'video')
    return <video src={src} controls playsInline preload="metadata" className="max-h-80 w-60 rounded-2xl border border-border bg-card" data-testid={`video-attachment-${a.id}`} />;
  return (
    <div className={cn('flex w-64 max-w-full flex-col gap-1 rounded-2xl border border-border px-2 py-2', mine ? 'bg-primary/10' : 'bg-secondary')}>
      <audio src={src} controls preload="metadata" className="h-10 w-full" data-testid={`audio-attachment-${a.id}`} />
      {a.durationSeconds ? <span className="px-2 text-[11px] text-muted-foreground">Audio · {formatDuration(a.durationSeconds)}</span> : null}
    </div>
  );
}
