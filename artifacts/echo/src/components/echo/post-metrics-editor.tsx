import { useRef, useState } from 'react';
import { SlidersHorizontal } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { Sheet } from './sheet';
import { Field, inputCls, parseBase } from './field';
import { shownCount } from '@/domain/accounts';
import { toast } from '@/hooks/use-toast';
import type { Post } from '@/domain/types';

export function PostMetricsEditor({ post, actualComments }: { post: Post; actualComments: number }) {
  const { actions } = useSocial();
  const [open, setOpen] = useState(false);
  const [likes, setLikes] = useState('');
  const [comments, setComments] = useState('');
  const [error, setError] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const original = useRef<NonNullable<Post['displayMetrics']>>({});

  const start = () => {
    original.current = structuredClone(post.displayMetrics ?? {});
    setLikes(post.displayMetrics?.likes?.toString() ?? '');
    setComments(post.displayMetrics?.comments?.toString() ?? '');
    setError(null);
    setOpen(true);
  };

  const save = () => {
    if (saving) return;
    setSaving(true);
    try {
      actions.updatePostMetrics(post.id, { likes: parseBase(likes), comments: parseBase(comments) }, original.current);
      toast({ title: 'Cifras visuales guardadas' });
      setOpen(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'No se pudo guardar.');
    } finally {
      setSaving(false);
    }
  };

  const preview = (v: string, real: number) => {
    try { return shownCount(parseBase(v), real).toLocaleString('es-ES'); } catch { return '—'; }
  };

  return (
    <>
      <button onClick={start} aria-label="Editar cifras visuales" className="tap -mr-1 grid h-9 w-9 place-items-center rounded-full hover:bg-secondary hover:text-foreground" data-testid={`button-edit-metrics-${post.id}`}>
        <SlidersHorizontal className="h-4 w-4" strokeWidth={1.7} />
      </button>
      <Sheet
        open={open}
        onClose={() => setOpen(false)}
        title="Cifras de la publicación"
        testId="sheet-post-metrics"
        footer={
          <div className="flex gap-2 pb-2">
            <button onClick={() => setOpen(false)} className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-medium" data-testid="button-cancel-metrics">Cancelar</button>
            <button onClick={save} disabled={saving} className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-60" data-testid="button-save-metrics">Guardar</button>
          </div>
        }
      >
        <p className="rounded-2xl bg-accent/30 p-3 text-[13px] leading-relaxed text-muted-foreground">
          La <b className="text-foreground">base visual</b> es una cifra decorativa que se suma a la actividad real. No crea me gusta ni comentarios: las listas siguen mostrando solo interacciones reales. Déjala vacía para volver a cero.
        </p>
        <Field id="metric-likes" label="Base visual · me gusta" hint={`Reales: ${post.likes.length} · Se mostrará: ${preview(likes, post.likes.length)}`}>
          <input id="metric-likes" inputMode="numeric" value={likes} onChange={(e) => setLikes(e.target.value)} placeholder="Vacío" className={inputCls} data-testid="input-metric-likes" />
        </Field>
        <Field id="metric-comments" label="Base visual · comentarios" hint={`Reales: ${actualComments} · Se mostrará: ${preview(comments, actualComments)}`}>
          <input id="metric-comments" inputMode="numeric" value={comments} onChange={(e) => setComments(e.target.value)} placeholder="Vacío" className={inputCls} data-testid="input-metric-comments" />
        </Field>
        {error && <p role="alert" className="mt-4 text-sm text-destructive" data-testid="text-metrics-error">{error}</p>}
      </Sheet>
    </>
  );
}
