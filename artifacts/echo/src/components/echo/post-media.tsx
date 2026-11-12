import { useRef, useState, type ReactNode } from 'react';
import { ChevronLeft, ChevronRight, ImageIcon, Expand, Shrink } from 'lucide-react';
import { GracefulImage } from './graceful-image';
import { useMediaResolver } from '@/lib/media';
import { cn } from '@/lib/utils';
import type { PostMedia } from '@/domain/types';

interface Props {
  postId: string;
  media: PostMedia[];
  alt: string;
  eager?: boolean;
  /** Called on a deliberate tap (not after a swipe). */
  onTap(): void;
  overlay?: ReactNode;
}

/** Single photo renders exactly like legacy posts; 2+ becomes a native scroll-snap carousel. */
export function PostMediaView({ postId, media, alt, eager, onTap, overlay }: Props) {
  const resolveScopedMedia = useMediaResolver();
  const resolveMedia = (ref: string) => resolveScopedMedia(ref, { sourceType: 'post', sourceContentId: postId });
  const scroller = useRef<HTMLDivElement>(null);
  const [index, setIndex] = useState(0);
  const [fit, setFit] = useState(false);
  const [imageRatios, setImageRatios] = useState<Record<string, number>>({});
  const rememberRatio = (key: string, image: HTMLImageElement) => {
    if (!image.naturalWidth || !image.naturalHeight) return;
    const ratio = image.naturalWidth / image.naturalHeight;
    setImageRatios(previous => previous[key] === ratio ? previous : { ...previous, [key]: ratio });
  };
  const fittedAspect = (key: string) => fit && imageRatios[key] ? { aspectRatio: String(imageRatios[key]) } : undefined;
  const downLeft = useRef(0);
  const count = media.length;

  const imageFallback = <span className="flex flex-col items-center gap-2 text-muted-foreground/55"><ImageIcon className="h-8 w-8" strokeWidth={1.2} /><span className="text-xs">Imagen no disponible</span></span>;
  if (count <= 1 && media[0]?.type === 'video') {
    return (
      <div className="relative w-full overflow-hidden bg-card sm:rounded-[22px]">
        <video src={resolveMedia(media[0].url)} controls playsInline preload="metadata" aria-label={alt || 'Video'} className="aspect-[4/5] w-full bg-black object-contain" data-testid={`video-post-${postId}`} />
        {overlay}
      </div>
    );
  }

  if (count <= 1) {
    return (
      <div className="relative w-full overflow-hidden bg-card sm:rounded-[22px]"><button onClick={onTap} className="relative block w-full overflow-hidden" aria-label="Doble toque para indicar que te gusta" data-testid={`button-image-${postId}`}>
        <GracefulImage key={resolveMedia(media[0]?.url ?? '')} src={resolveMedia(media[0]?.url ?? '')} alt={alt} loading={eager ? 'eager' : 'lazy'} fetchPriority={eager ? 'high' : 'auto'} draggable={false} containerClassName={`w-full ${fit ? '' : 'aspect-[4/5]'}`} style={fittedAspect(media[0]?.id ?? '')} onLoad={event => rememberRatio(media[0]?.id ?? '', event.currentTarget)} className={`absolute inset-0 h-full w-full ${fit ? 'object-contain' : 'object-cover'}`} fallback={<span className="absolute inset-0 animate-pulse bg-card" />} errorFallback={imageFallback} data-testid={`img-post-${postId}`} />
        {overlay}
      </button><button type="button" onClick={() => setFit(v => !v)} aria-label={fit ? "Ampliar foto" : "Ver foto completa"} title={fit ? "Ampliar foto" : "Ver foto completa"} className="absolute bottom-3 right-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white" data-testid={`button-post-fit-${postId}`}>{fit ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}</button></div>
    );
  }

  const go = (i: number) => {
    const el = scroller.current;
    if (!el) return;
    const next = Math.max(0, Math.min(count - 1, i));
    el.scrollTo({ left: next * el.clientWidth, behavior: 'smooth' });
  };

  return (
    <div className="relative w-full overflow-hidden bg-card sm:rounded-[22px]" role="region" aria-roledescription="carrusel" aria-label={`Carrusel de ${count} elementos`} data-testid={`carousel-post-${postId}`}>
      <div
        ref={scroller}
        onPointerDown={() => (downLeft.current = scroller.current?.scrollLeft ?? 0)}
        onClick={() => {
          if (Math.abs((scroller.current?.scrollLeft ?? 0) - downLeft.current) > 4) return;
          onTap();
        }}
        onScroll={(e) => {
          const el = e.currentTarget;
          const i = Math.round(el.scrollLeft / Math.max(1, el.clientWidth));
          if (i !== index) setIndex(i);
        }}
        onKeyDown={(e) => {
          if (e.key === 'ArrowRight') { e.preventDefault(); go(index + 1); }
          if (e.key === 'ArrowLeft') { e.preventDefault(); go(index - 1); }
        }}
        tabIndex={0}
        aria-label="Doble toque para indicar que te gusta. Flechas para cambiar de foto."
        className="no-scrollbar flex w-full snap-x snap-mandatory overflow-x-auto overscroll-x-contain"
        style={{ touchAction: 'pan-x pan-y' }}
        data-testid={`button-image-${postId}`}
      >
        {media.map((m, i) => (
          <div key={m.id} className="w-full shrink-0 snap-center snap-always" style={fittedAspect(media[index]?.id ?? '')} data-testid={`slide-post-${postId}-${i}`}>
            {m.type === 'video' ? (
              <video
                src={resolveMedia(m.url)}
                controls
                playsInline
                preload="metadata"
                onClick={(e) => e.stopPropagation()}
                aria-label={`${alt} · video ${i + 1} de ${count}`}
                className="aspect-[4/5] w-full bg-black object-contain"
                data-testid={`video-post-${postId}-${i}`}
              />
            ) : (
              <GracefulImage key={resolveMedia(m.url)} src={resolveMedia(m.url)} alt={`${alt} · foto ${i + 1} de ${count}`} loading={eager && i === 0 ? 'eager' : 'lazy'} draggable={false} containerClassName={`w-full ${fit ? '' : 'aspect-[4/5]'}`} style={fittedAspect(m.id)} onLoad={event => rememberRatio(m.id, event.currentTarget)} className={`absolute inset-0 h-full w-full ${fit ? 'object-contain' : 'object-cover'}`} fallback={imageFallback} data-testid={i === 0 ? `img-post-${postId}` : `img-post-${postId}-${i}`} />
            )}
          </div>
        ))}
      </div>
      {overlay}
      <button type="button" onClick={() => setFit(v => !v)} aria-label={fit ? "Ampliar foto" : "Ver foto completa"} className="absolute bottom-3 left-3 z-10 grid h-9 w-9 place-items-center rounded-full bg-black/65 text-white" data-testid={`button-post-fit-${postId}`}>{fit ? <Shrink className="h-4 w-4" /> : <Expand className="h-4 w-4" />}</button>
      <span className="pointer-events-none absolute right-3 top-3 rounded-full bg-[hsl(240_8%_3%/0.7)] px-2.5 py-1 text-[11.5px] font-semibold tabular-nums backdrop-blur" aria-live="polite" data-testid={`text-carousel-position-${postId}`}>
        {index + 1}/{count}
      </span>
      {index > 0 && (
        <button type="button" onClick={() => go(index - 1)} aria-label="Foto anterior" className="tap absolute left-1 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full sm:grid" data-testid={`button-carousel-prev-${postId}`}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(240_8%_3%/0.7)] backdrop-blur"><ChevronLeft className="h-4 w-4" /></span>
        </button>
      )}
      {index < count - 1 && (
        <button type="button" onClick={() => go(index + 1)} aria-label="Foto siguiente" className="tap absolute right-1 top-1/2 hidden h-11 w-11 -translate-y-1/2 place-items-center rounded-full sm:grid" data-testid={`button-carousel-next-${postId}`}>
          <span className="grid h-8 w-8 place-items-center rounded-full bg-[hsl(240_8%_3%/0.7)] backdrop-blur"><ChevronRight className="h-4 w-4" /></span>
        </button>
      )}
      <div className="pointer-events-none absolute inset-x-0 bottom-2.5 flex justify-center gap-1" aria-hidden>
        {media.map((m, i) => (
          <span key={m.id} className={cn('h-1.5 w-1.5 rounded-full transition-opacity', i === index ? 'bg-primary opacity-100' : 'bg-foreground opacity-40')} />
        ))}
      </div>
    </div>
  );
}
