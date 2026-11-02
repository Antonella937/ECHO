import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { AnimatePresence, motion } from 'framer-motion';
import { X } from 'lucide-react';

interface Props {
  open: boolean;
  onClose(): void;
  title: string;
  children: ReactNode;
  footer?: ReactNode;
  testId?: string;
}

/** Bottom sheet on phones, centered panel on desktop. */
export function Sheet({ open, onClose, title, children, footer, testId }: Props) {
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && onClose();
    window.addEventListener('keydown', onKey);
    const prev = document.body.style.overflow;
    document.body.style.overflow = 'hidden';
    return () => {
      window.removeEventListener('keydown', onKey);
      document.body.style.overflow = prev;
    };
  }, [open, onClose]);

  return createPortal(
    <AnimatePresence>
      {open && (
        <div className="fixed inset-0 z-[60] flex items-end justify-center md:items-center" data-testid={testId}>
          <motion.button
            aria-label="Cerrar"
            className="absolute inset-0 bg-[hsl(240_10%_2%/0.7)] backdrop-blur-[2px]"
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={onClose}
          />
          <motion.div
            role="dialog"
            aria-modal="true"
            aria-label={title}
            className="relative flex max-h-[calc(92dvh-env(safe-area-inset-top))] w-full max-w-[520px] flex-col rounded-t-[28px] border border-card-border bg-card shadow-xl md:rounded-[28px]"
            initial={{ y: 40, opacity: 0 }}
            animate={{ y: 0, opacity: 1 }}
            exit={{ y: 40, opacity: 0 }}
            transition={{ type: 'spring', damping: 30, stiffness: 320 }}
            drag="y"
            dragConstraints={{ top: 0, bottom: 0 }}
            dragElastic={{ top: 0, bottom: 0.5 }}
            onDragEnd={(_, info) => info.offset.y > 120 && onClose()}
          >
            <div className="mx-auto mt-2.5 h-1 w-10 rounded-full bg-[hsl(240_4%_24%)] md:hidden" />
            <div className="flex items-center justify-between px-5 pb-3 pt-3">
              <h2 className="font-display text-[17px] font-medium tracking-wide">{title}</h2>
              <button
                onClick={onClose}
                className="tap -mr-2 grid h-10 w-10 place-items-center rounded-full text-muted-foreground hover:bg-secondary hover:text-foreground"
                aria-label="Cerrar"
                data-testid="button-sheet-close"
              >
                <X className="h-5 w-5" strokeWidth={1.6} />
              </button>
            </div>
            <div className="min-h-0 flex-1 overflow-y-auto overscroll-contain px-5 pb-4" style={footer ? undefined : { paddingBottom: 'max(var(--echo-safe-bottom), 1rem)' }} onPointerDownCapture={(e) => e.stopPropagation()}>
              {children}
            </div>
            {footer && <div className="border-t border-border px-4 pb-safe pt-3">{footer}</div>}
          </motion.div>
        </div>
      )}
    </AnimatePresence>,
    document.body,
  );
}
