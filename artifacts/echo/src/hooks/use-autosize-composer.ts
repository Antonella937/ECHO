import { useLayoutEffect, useRef } from 'react';

export function useAutosizeComposer(value: string) {
  const ref = useRef<HTMLTextAreaElement>(null);

  useLayoutEffect(() => {
    const input = ref.current;
    if (!input) return;
    const resize = () => {
      const scrollTop = input.scrollTop;
      input.style.height = '';
      if (!input.value) return;
      const borderHeight = input.offsetHeight - input.clientHeight;
      input.style.height = `${input.scrollHeight + borderHeight}px`;
      input.scrollTop = scrollTop;
    };
    resize();
    let width = input.clientWidth;
    const observer = new ResizeObserver(() => {
      if (width === input.clientWidth) return;
      width = input.clientWidth;
      resize();
    });
    observer.observe(input);
    return () => observer.disconnect();
  }, [value]);

  return ref;
}
