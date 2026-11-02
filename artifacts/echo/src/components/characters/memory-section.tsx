import { useState } from 'react';
import { ArrowUp, Plus, Trash2 } from 'lucide-react';
import { inputCls } from '@/components/echo/field';
import { cn } from '@/lib/utils';
import { Area, Note, NumberInput, SubHead, uid, type SectionProps } from './ui';
import { useTargets } from './relationships-section';

type Mem = SectionProps['config']['memory']['permanent'][number];
type Bucket = 'permanent' | 'relationships' | 'recent';
const TITLES: Record<Bucket, string> = { permanent: 'Memoria fija', relationships: 'Memoria de vínculos', recent: 'Memoria reciente' };

export function MemorySection({ config, set, selfId }: SectionProps & { selfId?: string }) {
  const m = config.memory;
  const targets = useTargets(selfId);
  const upM = (patch: Partial<typeof m>) => set((c) => ({ ...c, memory: { ...c.memory, ...patch } }));
  const edit = (b: Bucket, id: string, patch: Partial<Mem>) => set((c) => ({ ...c, memory: { ...c.memory, [b]: c.memory[b].map((x) => (x.id === id ? { ...x, ...patch, updatedAt: new Date().toISOString() } : x)) } }));
  const remove = (b: Bucket, id: string) => set((c) => ({ ...c, memory: { ...c.memory, [b]: c.memory[b].filter((x) => x.id !== id) } }));
  const promote = (mem: Mem, to: 'permanent' | 'relationships') => set((c) => ({
    ...c, memory: { ...c.memory, recent: c.memory.recent.filter((x) => x.id !== mem.id), [to]: [...c.memory[to], { ...mem, promotedTo: to, updatedAt: new Date().toISOString() }] },
  }));

  const List = ({ b }: { b: Bucket }) => {
    const [draft, setDraft] = useState('');
    const cap = b === 'recent' ? m.recentLimit : 200;
    const add = () => {
      const text = draft.trim(); if (!text || m[b].length >= cap) return;
      const now = new Date().toISOString();
      upM({ [b]: [...m[b], { id: uid(), text, targetId: b === 'relationships' ? 'owner' : null, createdAt: now, updatedAt: now, kind: 'manual', sourceId: null, promotedTo: null }] });
      setDraft('');
    };
    return (
      <div data-testid={`list-memory-${b}`}>
        <SubHead>{TITLES[b]} <span className="text-xs text-muted-foreground">· {m[b].length}/{cap}</span></SubHead>
        {m[b].length === 0 && <p className="mt-2 px-1 text-xs text-muted-foreground">{b === 'recent' ? 'Se llena solo con actividad real (posts, historias, comentarios, mensajes).' : 'Vacía. Solo contiene lo que agregues vos.'}</p>}
        {m[b].map((x) => (
          <div key={x.id} className="mt-2 rounded-2xl border border-border p-2" data-testid={`card-memory-${x.id}`}>
            <textarea aria-label="Texto del recuerdo" value={x.text} maxLength={8000} rows={2} readOnly={b === 'recent'} onChange={(e) => edit(b, x.id, { text: e.target.value })} className={cn(inputCls, 'h-auto resize-y py-2 text-sm')} data-testid={`input-memory-${x.id}`} />
            <div className="mt-2 flex flex-wrap items-center gap-1.5">
              {b === 'relationships' && (
                <select aria-label="Sobre quién" value={x.targetId ?? 'owner'} onChange={(e) => edit(b, x.id, { targetId: e.target.value })} className={cn(inputCls, 'h-11 flex-1 text-xs')} data-testid={`select-memory-target-${x.id}`}>
                  {targets.map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
                </select>
              )}
              {b === 'recent' && <>
                <button type="button" onClick={() => promote(x, 'permanent')} className="tap inline-flex min-h-11 items-center gap-1 rounded-xl bg-secondary px-3 text-xs" data-testid={`button-promote-permanent-${x.id}`}><ArrowUp className="h-3.5 w-3.5" /> A fija</button>
                <button type="button" onClick={() => promote({ ...x, targetId: x.targetId ?? 'owner' }, 'relationships')} className="tap inline-flex min-h-11 items-center gap-1 rounded-xl bg-secondary px-3 text-xs" data-testid={`button-promote-relationship-${x.id}`}><ArrowUp className="h-3.5 w-3.5" /> A vínculo</button>
              </>}
              <button type="button" onClick={() => remove(b, x.id)} aria-label="Borrar recuerdo" className="tap ml-auto grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-destructive" data-testid={`button-remove-memory-${x.id}`}><Trash2 className="h-4 w-4" /></button>
            </div>
          </div>
        ))}
        {b !== 'recent' && <div className="mt-2 flex gap-2">
          <input aria-label={`Nuevo recuerdo en ${TITLES[b]}`} value={draft} maxLength={8000} onChange={(e) => setDraft(e.target.value)} onKeyDown={(e) => e.key === 'Enter' && (e.preventDefault(), add())} placeholder="Escribí un recuerdo…" className={inputCls} data-testid={`input-new-memory-${b}`} />
          <button type="button" onClick={add} aria-label="Agregar recuerdo" className="tap grid h-12 w-12 shrink-0 place-items-center rounded-2xl bg-primary text-primary-foreground" data-testid={`button-add-memory-${b}`}><Plus className="h-4 w-4" /></button>
        </div>}
      </div>
    );
  };

  return (
    <div data-testid="section-character-memory">
      <Note>La memoria fija y la de vínculos solo contienen lo que escribís o promovés vos. La reciente se llena sola con fragmentos breves de actividad real (posts, historias, comentarios y mensajes); ECHO nunca inventa recuerdos ni actúa por su cuenta.</Note>
      {List({ b: 'permanent' })}
      {List({ b: 'relationships' })}
      {List({ b: 'recent' })}
      <NumberInput id="memory-recent-limit" label="Límite de memoria reciente" value={m.recentLimit} onChange={(v) => upM({ recentLimit: v ?? 10 })} min={10} max={200} hint="Entre 10 y 200 recuerdos." />
      <Area id="memory-summary" label="Resumen reciente (opcional)" value={m.recentSummary} onChange={(recentSummary) => upM({ recentSummary })} max={8000} rows={3} />
    </div>
  );
}
