import { Plus, Trash2 } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { relationshipPresets } from '@/domain/character-core';
import { Field, inputCls } from '@/components/echo/field';
import { Area, GhostButton, Note, Slider, Text, uid, type SectionProps } from './ui';

type Rel = SectionProps['config']['relationships'][number];
export const OWNER_LABEL = 'Vos · propietario';

export function useTargets(selfId?: string) {
  const { state } = useSocial();
  return [
    { id: 'owner', label: OWNER_LABEL },
    ...state.characters.filter((c) => c.id !== selfId).map((c) => ({ id: c.id, label: `${c.name} · @${c.handle}${c.archived ? ' (archivada)' : ''}` })),
  ];
}

export function RelationshipsSection({ config, set, selfId }: SectionProps & { selfId?: string }) {
  const targets = useTargets(selfId);
  const rels = config.relationships;
  const upAll = (relationships: Rel[]) => set((c) => ({ ...c, relationships }));
  const up = (id: string, patch: Partial<Rel>) => set((c) => ({ ...c, relationships: c.relationships.map((r) => (r.id === id ? { ...r, ...patch } : r)) }));
  const used = new Set(rels.map((r) => r.targetId));
  const free = targets.filter((t) => !used.has(t.id));
  const add = () => {
    const t = free[0];
    if (!t || rels.length >= 300) return;
    upAll([...rels, { id: uid(), targetId: t.id, preset: t.id === 'owner' ? 'friend' : 'acquaintance', customLabel: '', description: '', closeness: 50, trust: 50, attraction: null, tension: null }]);
  };
  const label = (id: string) => targets.find((t) => t.id === id)?.label ?? 'Cuenta eliminada';

  return (
    <div data-testid="section-character-relationships">
      <Note>“{OWNER_LABEL}” sos vos, quien maneja este universo. Es distinto de Nela, que es un personaje más.</Note>
      {rels.length === 0 && <p className="mt-4 rounded-2xl border border-dashed border-border p-5 text-center text-sm text-muted-foreground">Sin vínculos definidos.</p>}
      {rels.map((r) => (
        <div key={r.id} className="mt-4 rounded-2xl border border-border bg-card/40 p-3" data-testid={`card-relationship-${r.id}`}>
          <div className="flex items-start justify-between gap-2">
            <p className="pt-2 text-sm font-semibold" data-testid={`text-relationship-target-${r.id}`}>{label(r.targetId)}</p>
            <button type="button" onClick={() => upAll(rels.filter((x) => x.id !== r.id))} aria-label="Quitar vínculo" className="tap grid h-11 w-11 place-items-center rounded-full text-muted-foreground hover:text-destructive" data-testid={`button-remove-relationship-${r.id}`}><Trash2 className="h-4 w-4" /></button>
          </div>
          <Field id={`rel-target-${r.id}`} label="Con quién">
            <select id={`rel-target-${r.id}`} value={r.targetId} onChange={(e) => up(r.id, { targetId: e.target.value })} className={inputCls} data-testid={`select-relationship-target-${r.id}`}>
              {targets.filter((t) => t.id === r.targetId || !used.has(t.id)).map((t) => <option key={t.id} value={t.id}>{t.label}</option>)}
              {!targets.some((t) => t.id === r.targetId) && <option value={r.targetId}>Cuenta eliminada</option>}
            </select>
          </Field>
          <Field id={`rel-preset-${r.id}`} label="Tipo de vínculo">
            <select id={`rel-preset-${r.id}`} value={r.preset} onChange={(e) => up(r.id, { preset: e.target.value as Rel['preset'] })} className={inputCls} data-testid={`select-relationship-preset-${r.id}`}>
              {Object.entries(relationshipPresets).map(([k, v]) => <option key={k} value={k}>{String(v)}</option>)}
            </select>
          </Field>
          <Text id={`rel-label-${r.id}`} label="Etiqueta propia (opcional)" value={r.customLabel} onChange={(customLabel) => up(r.id, { customLabel })} max={200} testId={`input-relationship-label-${r.id}`} />
          <Area id={`rel-desc-${r.id}`} label="Historia y matices" value={r.description} onChange={(description) => up(r.id, { description })} max={8000} rows={3} testId={`input-relationship-description-${r.id}`} />
          <Slider id={`rel-close-${r.id}`} label="Cercanía" value={r.closeness} onChange={(closeness) => up(r.id, { closeness })} />
          <Slider id={`rel-trust-${r.id}`} label="Confianza" value={r.trust} onChange={(trust) => up(r.id, { trust })} />
          {(['attraction', 'tension'] as const).map((k) => r[k] == null ? (
            <div key={k} className="mt-2"><GhostButton onClick={() => up(r.id, { [k]: 30 })} testId={`button-enable-${k}-${r.id}`}><Plus className="h-3.5 w-3.5" /> {k === 'attraction' ? 'Agregar atracción' : 'Agregar tensión'}</GhostButton></div>
          ) : (
            <div key={k} className="flex items-end gap-2">
              <div className="flex-1"><Slider id={`rel-${k}-${r.id}`} label={k === 'attraction' ? 'Atracción' : 'Tensión'} value={r[k]!} onChange={(n) => up(r.id, { [k]: n })} /></div>
              <GhostButton onClick={() => up(r.id, { [k]: null })} testId={`button-clear-${k}-${r.id}`}>Quitar</GhostButton>
            </div>
          ))}
        </div>
      ))}
      <button type="button" onClick={add} disabled={!free.length} className="tap mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/50 text-sm font-semibold text-primary disabled:opacity-50" data-testid="button-add-relationship">
        <Plus className="h-4 w-4" /> Agregar vínculo
      </button>
    </div>
  );
}
