import { Sparkles } from 'lucide-react';
import { useGetCharacterAssistance } from '@workspace/api-client-react';
import { Area, type SectionProps } from './ui';

/** Assisted creation. No provider is configured: this never generates or parses anything. */
export function AssistedPanel({ config, set, onManual }: SectionProps & { onManual(): void }) {
  const { data, isLoading, isError, refetch } = useGetCharacterAssistance();
  const available = data?.available === true;
  return (
    <div data-testid="panel-character-assisted">
      <div className="mt-4 rounded-2xl border border-primary/30 bg-accent/30 p-4" role="status" data-testid="status-character-assistance">
        <p className="flex items-center gap-2 text-sm font-semibold"><Sparkles className="h-4 w-4 text-primary" /> Asistente de personajes</p>
        {isLoading ? <div className="mt-2 h-4 w-2/3 animate-pulse rounded bg-secondary" /> : isError ? (
          <p className="mt-2 text-[13px] text-muted-foreground">No pudimos consultar el estado. <button type="button" onClick={() => refetch()} className="min-h-11 font-semibold text-primary underline" data-testid="button-retry-assistance">Reintentar</button></p>
        ) : (
          <p className="mt-2 text-[13px] leading-relaxed text-muted-foreground" data-testid="text-assistance-reason">
            {available ? 'Hay un proveedor disponible, pero la generación todavía no está habilitada en ECHO.' : `No disponible: ${data?.reason ?? 'no hay un proveedor configurado.'}`}
            {' '}No se envía nada a ningún modelo y no se inventan datos.
          </p>
        )}
      </div>
      <Area id="character-assist-description" label="Describí al personaje con tus palabras" value={config.assistance.description} max={8000} rows={8}
        onChange={(description) => set((c) => ({ ...c, assistance: { ...c.assistance, description, status: 'unavailable', provider: null } }))}
        placeholder="Bajista de 27 años, irónica, trabaja en una disquería de San Telmo…" />
      <p className="mt-1 px-1 text-xs text-muted-foreground">Se guarda junto al personaje para cuando haya asistencia.</p>
      <button type="button" disabled className="mt-4 flex h-12 w-full items-center justify-center gap-2 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground opacity-50" data-testid="button-assist-generate" aria-describedby="text-assistance-reason">
        <Sparkles className="h-4 w-4" /> Generar propuesta (no disponible)
      </button>
      <button type="button" onClick={onManual} className="tap mt-2 flex h-12 w-full items-center justify-center rounded-2xl border border-border text-sm font-semibold" data-testid="button-assist-continue-manual">
        Continuar a mano en modo avanzado
      </button>
    </div>
  );
}
