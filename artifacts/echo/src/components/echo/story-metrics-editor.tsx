import { useRef, useState, type FormEvent } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { storyViewerIds, shownCount, type StoryMetrics } from '@/domain/accounts';
import type { Story } from '@/domain/types';
import { useSocial } from '@/store/social-store';
import { Field, inputCls, parseBase } from './field';
import { toast } from '@/hooks/use-toast';

/** Inline in the existing author footer: no additional overlay or viewer redesign. */
export function StoryMetricsEditor({ story, onOpenChange }: { story: Story; onOpenChange(open: boolean): void }) {
  const { actions } = useSocial();
  const [open, setOpen] = useState(false);
  const [value, setValue] = useState('');
  const [error, setError] = useState<string | null>(null);
  const original = useRef<StoryMetrics>({});
  const real = storyViewerIds(story).length;
  const close = () => { setOpen(false); onOpenChange(false); };
  const start = () => {
    original.current = structuredClone(story.displayMetrics ?? {});
    setValue(story.displayMetrics?.views?.toString() ?? '');
    setError(null); setOpen(true); onOpenChange(true);
  };
  let preview = '—';
  try { preview = shownCount(parseBase(value), real).toLocaleString('es-ES'); } catch { /* Invalid drafts are not saved. */ }
  const save = (event: FormEvent) => {
    event.preventDefault();
    try {
      actions.updateStoryMetrics(story.id, { views: parseBase(value) }, original.current);
      close(); toast({ title: 'Cifras visuales guardadas' });
    } catch (e) { setError(e instanceof Error ? e.message : 'No se pudo guardar.'); }
  };
  return (
    <>
      <button type="button" onClick={start} aria-label="Editar cifras de la historia"
        className="tap absolute right-0 top-0 grid h-11 w-11 place-items-center rounded-full hover:bg-secondary"
        data-testid="button-edit-story-metrics"><SlidersHorizontal className="h-4 w-4" strokeWidth={1.7} /></button>
      {open && (
        <form onSubmit={save} aria-label="Cifras de la historia" className="mt-1 rounded-3xl bg-card/95 p-3 backdrop-blur"
          onKeyDown={event => { event.stopPropagation(); if (event.key === 'Escape') { event.preventDefault(); close(); } }}>
          <p className="text-xs leading-relaxed text-muted-foreground">La base visual se suma a las vistas reales. No agrega personas a la lista. Vacía vuelve a cero.</p>
          <Field id="story-metric-views" label="Base visual · visualizaciones" hint={`Reales: ${real} · Se mostrará: ${preview}`}>
            <input autoFocus id="story-metric-views" inputMode="numeric" value={value} onChange={e => setValue(e.target.value)}
              placeholder="Vacío" className={inputCls} data-testid="input-story-metric-views" />
          </Field>
          {error && <p role="alert" className="mt-3 text-sm text-destructive" data-testid="text-story-metrics-error">{error}</p>}
          <div className="mt-3 flex gap-2">
            <button type="button" onClick={close} className="h-11 flex-1 rounded-2xl bg-secondary text-sm font-medium">Cancelar</button>
            <button type="submit" className="h-11 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground"
              data-testid="button-save-story-metrics">Guardar</button>
          </div>
        </form>
      )}
    </>
  );
}
