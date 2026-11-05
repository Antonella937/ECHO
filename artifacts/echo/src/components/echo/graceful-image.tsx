import { useState, type ImgHTMLAttributes, type ReactNode } from 'react';
import { cn } from '@/lib/utils';

type Props = ImgHTMLAttributes<HTMLImageElement> & {
  fallback: ReactNode;
  containerClassName?: string;
};

/** Keep the media box stable and never expose the browser's broken-image icon. */
export function GracefulImage({ src, fallback, containerClassName, className, onLoad, onError, ...props }: Props) {
  const [state, setState] = useState<'loading' | 'loaded' | 'failed'>('loading');
  return (
    <span className={cn('relative block overflow-hidden', containerClassName)}>
      {state !== 'loaded' && (
        <span className="absolute inset-0 flex items-center justify-center bg-muted" aria-hidden="true">
          {fallback}
        </span>
      )}
      {src && state !== 'failed' && (
        <img
          {...props}
          src={src}
          className={cn(className, state !== 'loaded' && 'opacity-0', 'transition-opacity duration-200')}
          onLoad={(event) => { setState('loaded'); onLoad?.(event); }}
          onError={(event) => { setState('failed'); onError?.(event); }}
        />
      )}
    </span>
  );
}
