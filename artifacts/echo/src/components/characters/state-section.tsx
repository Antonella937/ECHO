import { useState } from 'react';
import { CalendarClock } from 'lucide-react';
import { deriveRoutineContext } from '@/domain/character-core';
import { Field, inputCls } from '@/components/echo/field';
import { Area, Note, Text, type SectionProps } from './ui';
import { useTargets } from './relationships-section';

type State = SectionProps['config']['currentState'];
const toLocal = (iso: string | null) => { if (!iso) return ''; const d = new Date(iso); return Number.isNaN(+d) ? '' : new Date(d.getTime() - d.getTimezoneOffset() * 60000).toISOString().slice(0, 16); };

export function StateSection({ config, set, selfId }: SectionProps & { selfId?: string }) {
  const s = config.currentState;
  const targets = useTargets(selfId);
  const [error, setError] = useState('');
  const [preview, setPreview] = useState<Partial<State> | null>(null);
  const [rev, setRev] = useState(0);
  const up = (patch: Partial<State>, source: State['source'] = 'manual') =>
    set((c) => ({ ...c, currentState: { ...c.currentState, ...patch, source, updatedAt: new Date().toISOString() } }));

  return (
    <div data-testid="section-character-state">
      <Note>Estado manual: lo que el personaje está haciendo ahora según vos. No cambia solo con el tiempo.</Note>
      <p className="mt-3 px-1 text-xs text-muted-foreground" data-testid="text-state-source">
        Origen: {s.source === 'routine' ? 'aplicado desde la rutina' : 'manual'} · {s.updatedAt === '1970-01-01T00:00:00.000Z' ? 'sin correcciones guardadas todavía' : `actualizado ${new Date(s.updatedAt).toLocaleString('es')}`}
      </p>
      <div key={rev}>
        <Text id="state-location" label="Dónde está" value={s.location} onChange={(location) => up({ location })} max={500} />
        <Area id="state-activity" label="Qué está haciendo" value={s.activity} onChange={(activity) => up({ activity })} max={1000} rows={2} />
        <Text id="state-mood" label="Ánimo" value={s.mood} onChange={(mood) => up({ mood })} max={500} />
        <fieldset className="mt-4">
          <legend className="mb-2 text-sm font-medium">Con quién está</legend>
          <div className="flex max-h-48 flex-wrap gap-2 overflow-y-auto">
            {targets.map(target => <label key={target.id} className="flex min-h-11 items-center gap-2 rounded-xl border border-border px-3 text-xs">
              <input type="checkbox" checked={s.companions.includes(target.id)} onChange={e => up({ companions: e.target.checked ? [...s.companions, target.id] : s.companions.filter(id => id !== target.id) })} data-testid={`checkbox-state-companion-${target.id}`} />
              {target.label}
            </label>)}
          </div>
        </fieldset>
        <Field id="state-last" label="Última actividad · hora de este dispositivo">
          <input id="state-last" type="datetime-local" value={toLocal(s.lastActivityAt)} onChange={(e) => up({ lastActivityAt: e.target.value ? new Date(e.target.value).toISOString() : null })} className={inputCls} data-testid="input-state-last" />
        </Field>
        <Text id="state-next" label="Próximo evento" value={s.nextEvent} onChange={(nextEvent) => up({ nextEvent })} max={1000} />
      </div>

      <div className="mt-6 rounded-2xl border border-border p-3">
        <button type="button" onClick={() => { try { setPreview(deriveRoutineContext(config, new Date())); setError(''); } catch { setError('Revisá la zona horaria antes de consultar la rutina.'); } }} className="tap flex min-h-11 w-full items-center justify-center gap-2 rounded-xl bg-secondary px-2 py-2 text-sm font-semibold" data-testid="button-preview-routine-state">
          <CalendarClock className="h-4 w-4" /> Ver qué sugiere la rutina ahora
        </button>
        {error && <p role="alert" className="mt-2 text-sm text-destructive">{error}</p>}
        {preview && (
          <div className="mt-3 text-sm" data-testid="panel-routine-preview">
            {Object.keys(preview).length === 0 ? <p className="text-muted-foreground">La rutina no tiene nada para este momento.</p> : (
              <dl className="grid grid-cols-[auto_1fr] gap-x-3 gap-y-1">
                {preview.location != null && <><dt className="text-muted-foreground">Lugar</dt><dd>{preview.location || '—'}</dd></>}
                {preview.activity != null && <><dt className="text-muted-foreground">Actividad</dt><dd>{preview.activity || '—'}</dd></>}
                {preview.nextEvent != null && <><dt className="text-muted-foreground">Después</dt><dd>{preview.nextEvent || '—'}</dd></>}
              </dl>
            )}
            <div className="mt-3 flex gap-2">
              <button type="button" onClick={() => setPreview(null)} className="h-11 flex-1 rounded-xl bg-secondary text-sm" data-testid="button-dismiss-routine-preview">Descartar</button>
              <button type="button" disabled={Object.keys(preview).length === 0} onClick={() => { up(preview, 'routine'); setPreview(null); setRev((n) => n + 1); }} className="h-11 flex-1 rounded-xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50" data-testid="button-apply-routine-state">Aplicar</button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
