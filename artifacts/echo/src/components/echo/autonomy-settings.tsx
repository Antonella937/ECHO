import { useState } from "react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAutonomySettingsQueryKey,
  useGetAutonomySettings,
  useRunAutonomyDryRun,
  useUpdateAutonomySettings,
} from "@workspace/api-client-react";
import type { AutonomyDryRunResult } from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { cn } from "@/lib/utils";

const labels: Record<AutonomyDryRunResult["status"], string> = {
  previewed: "Preview completado",
  no_opportunity: "Decisión de silencio",
  cooldown: "En pausa por cooldown",
  rate_limited: "Límite alcanzado",
  duplicate: "Solicitud duplicada",
  in_progress: "Simulación en curso",
};

export function AutonomySettingsSection() {
  const client = useQueryClient();
  const query = useGetAutonomySettings();
  const update = useUpdateAutonomySettings();
  const dryRun = useRunAutonomyDryRun();
  const [latest, setLatest] = useState<AutonomyDryRunResult | null>(null);
  const settings = query.data;
  const updateCache = (next: NonNullable<typeof settings>) => {
    client.setQueryData(getGetAutonomySettingsQueryKey(), next);
  };

  const setKillSwitch = (engaged: boolean) => update.mutate(
    { data: { globalKillSwitchEngaged: engaged } },
    { onSuccess: updateCache, onError: () => toast({ title: "No se pudo guardar el bloqueo global", variant: "destructive" }) },
  );

  const setCharacter = (characterId: string, enabled: boolean) => update.mutate(
    { data: { characterId, enabled } },
    {
      onSuccess: updateCache,
      onError: () => toast({ title: "No se pudo guardar el control del personaje", variant: "destructive" }),
    },
  );

  const runPreview = (characterId: string) => {
    if (!globalThis.crypto?.randomUUID) {
      toast({ title: "Este navegador no permite iniciar una simulación segura", variant: "destructive" });
      return;
    }
    dryRun.mutate(
      { data: { characterId, idempotencyKey: globalThis.crypto.randomUUID() } },
      {
        onSuccess: setLatest,
        onError: () => toast({ title: "No se pudo completar la simulación", description: "No se ejecutó ninguna acción social.", variant: "destructive" }),
      },
    );
  };

  return (
    <section className="mt-9" aria-labelledby="autonomy-h">
      <h2 id="autonomy-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        Autonomía de texto
      </h2>
      <p className="mt-1.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
        Las simulaciones son manuales. La ejecución automática está desactivada en esta etapa.
      </p>
      <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card/60">
        <div className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">Bloqueo global</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {settings?.globalKillSwitchEngaged === false ? "Pausa general desactivada; el motor en vivo sigue apagado." : "Pausa general activa para todas las cuentas."}
            </div>
          </div>
          <Switch
            checked={settings?.globalKillSwitchEngaged ?? true}
            disabled={!settings || update.isPending}
            onCheckedChange={setKillSwitch}
            aria-label="Bloqueo global de autonomía"
            data-testid="switch-autonomy-kill-switch"
          />
        </div>

        {query.isLoading && <div className="p-4 text-xs text-muted-foreground">Cargando controles privados…</div>}
        {query.isError && (
          <div role="alert" className="p-4 text-xs text-destructive">
            No se pudieron cargar los controles de autonomía. No se habilitó ninguna cuenta.
          </div>
        )}
        {settings?.characters.map((character) => (
          <div key={character.characterId} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{character.displayName}</div>
              <div className="mt-1 text-xs text-muted-foreground">@{character.username}</div>
              <div className="mt-1 text-[11px] leading-relaxed text-muted-foreground">
                {character.enabled ? "Designada por ti para autonomía futura" : "Solo se opera manualmente"}
              </div>
            </div>
            <Switch
              checked={character.enabled}
              disabled={update.isPending}
              onCheckedChange={(enabled) => setCharacter(character.characterId, enabled)}
              aria-label={`Permitir autonomía futura para ${character.displayName}`}
              data-testid={`switch-autonomy-character-${character.characterId}`}
            />
            <button
              type="button"
              disabled={dryRun.isPending || query.isLoading}
              onClick={() => runPreview(character.characterId)}
              className="h-9 shrink-0 rounded-xl border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              data-testid={`button-autonomy-dry-run-${character.characterId}`}
            >
              {dryRun.isPending ? "Simulando…" : "Simular"}
            </button>
          </div>
        ))}
      </div>

      {latest && (
        <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4" aria-live="polite" data-testid="autonomy-dry-run-result">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold">
              {labels[latest.status]} · {latest.preview?.decision.action === "draft" ? "propuesta" : latest.preview ? "no actuar" : "sin llamada al modelo"}
            </div>
            <span className={cn("rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground")}>
              Solo preview
            </span>
          </div>
          <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{latest.reason}</p>
          {latest.preview && (
            <>
              {latest.preview.decision.text && (
                <p className="mt-3 whitespace-pre-wrap rounded-xl bg-background/70 p-3 text-[13px] leading-relaxed">
                  {latest.preview.decision.text}
                </p>
              )}
              <p className="mt-2 text-xs leading-relaxed text-muted-foreground">{latest.preview.decision.reason}</p>
            </>
          )}
          <p className="mt-2 text-[11px] text-muted-foreground">
            Sin publicaciones, comentarios ni mensajes enviados. Ejecución en vivo: desactivada.
          </p>
        </div>
      )}
    </section>
  );
}
