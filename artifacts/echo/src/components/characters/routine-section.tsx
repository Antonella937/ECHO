import { useCharacterActivityText } from '@/lib/character-activity-translations';
import { Plus, Trash2 } from 'lucide-react';
import { Field, inputCls } from '@/components/echo/field';
import { cn } from '@/lib/utils';
import { Area, Note, Select, Text, level, uid, type SectionProps } from './ui';

type Entry = SectionProps['config']['routine']['entries'][number];
const DAYS = ['Lu', 'Ma', 'Mi', 'Ju', 'Vi', 'Sá', 'Do'];
const ACTIVITIES = { sleep: t("Dormir"), work: t("Trabajo"), study: t("Estudio"), meal: t("Comida"), exercise: t("Ejercicio"), rehearsal: t("Ensayo"), social: t("Social"), leisure: t("Ocio"), custom: t("Otra") } as const;

export function RoutineSection({ config, set }: SectionProps) {
  const t = useCharacterActivityText();
  const r = config.routine;
  const upR = (patch: Partial<typeof r>) => set((c) => ({ ...c, routine: { ...c.routine, ...patch } }));
  const up = (id: string, patch: Partial<Entry>) => set((c) => ({ ...c, routine: { ...c.routine, entries: c.routine.entries.map((e) => (e.id === id ? { ...e, ...patch } : e)) } }));
  const add = () => r.entries.length < 100 && upR({ entries: [...r.entries, { id: uid(), title: '', activity: 'custom', weekdays: [1, 2, 3, 4, 5], start: '09:00', end: '17:00', location: '', recurrence: 'weekly', date: null, flexibility: 'medium' }] });

  return (
    <div data-testid="section-character-routine">
      <Note>{t("La rutina da")} <b className="text-foreground">{t("contexto y probabilidad")}</b>{t(": dónde suele estar y qué suele hacer. No es un horario de robot ni ejecuta nada sola.")}</Note>
      <Text id="character-timezone" label={t("Zona horaria")} value={r.timezone} onChange={(timezone) => upR({ timezone })} max={100} placeholder="America/Argentina/Buenos_Aires" />
      <Area id="character-flexibility" label={t("Flexibilidad general")} value={r.flexibilityNotes} onChange={(flexibilityNotes) => upR({ flexibilityNotes })} max={4000} rows={2} />
      {r.entries.map((e) => (
        <div key={e.id} className="mt-4 rounded-2xl border border-border bg-card/40 p-3" data-testid={`card-routine-${e.id}`}>
          <div className="flex items-end gap-2">
            <div className="flex-1"><Text id={`rt-title-${e.id}`} label={t("Bloque")} value={e.title} onChange={(title) => up(e.id, { title })} max={200} placeholder={t("Ensayo con la banda")} testId={`input-routine-title-${e.id}`} /></div>
            <button type="button" onClick={() => upR({ entries: r.entries.filter((x) => x.id !== e.id) })} aria-label={t("Quitar bloque")} className="tap grid h-12 w-11 place-items-center rounded-full text-muted-foreground hover:text-destructive" data-testid={`button-remove-routine-${e.id}`}><Trash2 className="h-4 w-4" /></button>
          </div>
          <div className="grid grid-cols-2 gap-3">
            <Select id={`rt-act-${e.id}`} label={t("Actividad")} value={e.activity} onChange={(activity) => up(e.id, { activity })} options={Object.fromEntries(Object.entries(ACTIVITIES).map(([key,value]) => [key,t(value)]))} />
            <Select id={`rt-rec-${e.id}`} label={t("Repetición")} value={e.recurrence} onChange={(recurrence) => up(e.id, recurrence === 'once' ? { recurrence, date: e.date ?? new Date().toISOString().slice(0, 10) } : { recurrence, date: null })} options={{ weekly: t("Semanal"), once: t("Una vez") }} />
          </div>
          {e.recurrence === 'once' ? (
            <Field id={`rt-date-${e.id}`} label={t("Fecha")}>
              <input id={`rt-date-${e.id}`} type="date" value={e.date ?? ''} onChange={(ev) => up(e.id, { date: ev.target.value || null })} className={inputCls} data-testid={`input-routine-date-${e.id}`} />
            </Field>
          ) : (
            <fieldset className="mt-4">
              <legend className="mb-1.5 px-1 text-[11px] uppercase tracking-[0.16em] text-muted-foreground">{t("Días")}</legend>
              <div className="grid grid-cols-4 gap-1 min-[480px]:grid-cols-7">
                {DAYS.map((d, i) => {
                  const n = i + 1, on = e.weekdays.includes(n);
                  return (
                    <label key={d} className={cn('grid h-11 flex-1 cursor-pointer place-items-center rounded-xl border text-xs font-semibold', on ? 'border-primary bg-primary/15 text-primary' : 'border-border text-muted-foreground')}>
                      <input type="checkbox" className="sr-only" checked={on} aria-label={t(d)} onChange={() => up(e.id, { weekdays: on ? e.weekdays.filter((x) => x !== n) : [...e.weekdays, n].sort() })} data-testid={`checkbox-routine-day-${e.id}-${n}`} />{t(d)}
                    </label>
                  );
                })}
              </div>
            </fieldset>
          )}
          <div className="grid grid-cols-2 gap-3">
            {(['start', 'end'] as const).map((k) => (
              <Field key={k} id={`rt-${k}-${e.id}`} label={k === 'start' ? t('Desde') : t('Hasta')}>
                <input id={`rt-${k}-${e.id}`} type="time" value={e[k]} onChange={(ev) => ev.target.value && up(e.id, { [k]: ev.target.value })} className={inputCls} data-testid={`input-routine-${k}-${e.id}`} />
              </Field>
            ))}
          </div>
          {e.end <= e.start && <p className="mt-1.5 px-1 text-xs text-primary">{t("Termina al día siguiente (horario nocturno).")}</p>}
          <div className="grid grid-cols-2 gap-3">
            <Text id={`rt-loc-${e.id}`} label={t("Lugar")} value={e.location} onChange={(location) => up(e.id, { location })} max={500} testId={`input-routine-location-${e.id}`} />
            <Select id={`rt-flex-${e.id}`} label={t("Flexibilidad")} value={e.flexibility} onChange={(flexibility) => up(e.id, { flexibility })} options={level} />
          </div>
        </div>
      ))}
      <button type="button" onClick={add} className="tap mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-dashed border-primary/50 text-sm font-semibold text-primary" data-testid="button-add-routine">
        <Plus className="h-4 w-4" /> {t("Agregar bloque")}
      </button>
    </div>
  );
}
