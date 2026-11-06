import { useAdvancedSettingsText } from '@/lib/advanced-settings-translations';
import { useState } from "react";
import { useEffect } from "react";
import { useUser } from "@clerk/react";
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
import { getActiveUniverseId } from "@/store/persistence";

const labels: Record<AutonomyDryRunResult["status"], string> = {
  previewed: "Preview completado",
  no_opportunity: "Decisión de silencio",
  cooldown: "En pausa por cooldown",
  rate_limited: "Límite alcanzado",
  duplicate: "Solicitud duplicada",
  in_progress: "Simulación en curso",
};

export function AutonomySettingsSection() {
  const t = useAdvancedSettingsText();
  const { user } = useUser();
  const universeId = user?.id ? getActiveUniverseId(user.id) : "primary";
  const client = useQueryClient();
  const query = useGetAutonomySettings({ universeId });
  const update = useUpdateAutonomySettings();
  const dryRun = useRunAutonomyDryRun();
  const [latest, setLatest] = useState<AutonomyDryRunResult | null>(null);
  const [simulatingCharacterId, setSimulatingCharacterId] = useState<string | null>(null);
  const [previewError, setPreviewError] = useState<string | null>(null);
  const [updatingControl, setUpdatingControl] = useState<string | null>(null);
  const settings = query.data;
  const [dmDrafts, setDmDrafts] = useState<Record<string, { dmFrequency: "rarely" | "sometimes" | "frequently"; dmMediaPreference: "text" | "mixed" | "voice"; dmInstructions: string }>>({});
  useEffect(() => {
    if (!query.data) return;
    setDmDrafts(Object.fromEntries(query.data.characters.map((character) => [character.characterId, { dmFrequency: character.dmFrequency, dmMediaPreference: character.dmMediaPreference === "voice" ? "text" : character.dmMediaPreference, dmInstructions: character.dmInstructions }])));
  }, [query.data]);
  const updateCache = (next: NonNullable<typeof settings>) => {
    client.setQueryData(getGetAutonomySettingsQueryKey({ universeId: next.universeId }), next);
  };

  const setKillSwitch = (engaged: boolean) => update.mutate(
    { data: { globalKillSwitchEngaged: engaged, universeId } },
    { onSuccess: updateCache, onError: () => toast({ title: t("No se pudo guardar el bloqueo global"), variant: "destructive" }) },
  );

  const setCharacter = (characterId: string, enabled: boolean, lane: "social" | "dm") => {
    setUpdatingControl(`${lane}:${characterId}`);
    update.mutate(
      { data: { characterId, enabled, lane, universeId } },
      {
        onSuccess: updateCache,
        onError: () => toast({ title: t("No se pudo guardar el control del personaje"), variant: "destructive" }),
        onSettled: () => setUpdatingControl(null),
      },
    );
  };

  const saveDmPreferences = (characterId: string) => {
    const dmPreferences = dmDrafts[characterId];
    if (!dmPreferences) return;
    setUpdatingControl(`prefs:${characterId}`);
    update.mutate({ data: { characterId, dmPreferences, universeId } }, {
      onSuccess: updateCache,
      onError: () => toast({ title: t("No se pudieron guardar las preferencias de mensajes"), variant: "destructive" }),
      onSettled: () => setUpdatingControl(null),
    });
  };

  const runPreview = (characterId: string) => {
    setLatest(null);
    setPreviewError(null);
    if (!globalThis.crypto?.randomUUID) {
      toast({ title: t("Este navegador no permite iniciar una simulación segura"), variant: "destructive" });
      return;
    }
    setSimulatingCharacterId(characterId);
    dryRun.mutate(
      { data: { characterId, idempotencyKey: globalThis.crypto.randomUUID(), universeId } },
      {
        onSuccess: (result) => { setPreviewError(null); setLatest(result); setSimulatingCharacterId(null); },
        onError: (error) => {
          const candidate = error as { data?: { error?: unknown }; response?: { data?: { error?: unknown } }; message?: unknown };
          const code = candidate.data?.error ?? candidate.response?.data?.error;
          const safeCode = typeof code === "string" && /^[A-Z][A-Z0-9_]{2,80}$/.test(code) ? code : "AUTONOMY_PREVIEW_UNAVAILABLE";
          setPreviewError(safeCode);
          setSimulatingCharacterId(null);
          toast({ title: t("No se pudo completar la simulación"), description: `${t("Código:")} ${safeCode}. ${t("No se ejecutó ninguna acción social.")}`, variant: "destructive" });
        },
      },
    );
  };

  return (
    <section className="mt-9" aria-labelledby="autonomy-h">
      <h2 id="autonomy-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {t("Autonomía de texto")}
      </h2>
      <p className="mt-1.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
        {settings?.liveExecutionEnabled ? t("Beta privada: los personajes habilitados pueden actuar solos con IA de texto. Las imágenes IA permanecen apagadas.") : t("La autonomía en vivo todavía no está habilitada para esta cuenta; las simulaciones son manuales.")}
      </p>
      <div className="mt-3 divide-y divide-border rounded-2xl border border-border bg-card/60">
        <div className="flex items-center gap-3 p-4">
          <div className="min-w-0 flex-1">
            <div className="text-sm font-semibold">{t("Bloqueo global")}</div>
            <div className="mt-1 text-xs leading-relaxed text-muted-foreground">
              {settings?.globalKillSwitchEngaged === false ? settings.liveExecutionEnabled ? t("Pausa general desactivada; los personajes habilitados pueden actuar.") : t("Pausa general desactivada; el motor en vivo sigue apagado.") : t("Pausa general activa para todas las cuentas.")}
            </div>
          </div>
          <Switch
            checked={settings?.globalKillSwitchEngaged ?? true}
            disabled={!settings || update.isPending}
            onCheckedChange={setKillSwitch}
            aria-label={t("Bloqueo global de autonomía")}
            data-testid="switch-autonomy-kill-switch"
          />
        </div>

        {query.isLoading && <div className="p-4 text-xs text-muted-foreground">{t("Cargando controles privados…")}</div>}
        {query.isError && (
          <div role="alert" className="p-4 text-xs text-destructive">
            {t("No se pudieron cargar los controles de autonomía. No se habilitó ninguna cuenta.")}
          </div>
        )}
        <div className="p-4">
          <h3 className="text-sm font-semibold">{t("Autonomía social")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("Elegí quién puede publicar, comentar, dar me gusta y reaccionar por su cuenta.")}</p>
        </div>
        {settings?.characters.map((character) => (
          <div key={`social-${character.characterId}`} className="flex items-center gap-3 p-4">
            <div className="min-w-0 flex-1">
              <div className="truncate text-sm font-semibold">{character.displayName}</div>
              <div className="mt-1 text-xs text-muted-foreground">@{character.username}</div>
            </div>
            <Switch
              checked={character.enabled}
              disabled={update.isPending && updatingControl === `social:${character.characterId}`}
              onCheckedChange={(enabled) => setCharacter(character.characterId, enabled, "social")}
              aria-label={`${t("Autonomía social para")} ${character.displayName}`}
              data-testid={`switch-autonomy-character-${character.characterId}`}
            />
            <button
              type="button"
              disabled={(dryRun.isPending && simulatingCharacterId === character.characterId) || query.isLoading}
              onClick={() => runPreview(character.characterId)}
              className="h-9 shrink-0 rounded-xl border border-border px-3 text-xs font-semibold text-foreground transition-colors hover:bg-secondary disabled:opacity-50"
              data-testid={`button-autonomy-dry-run-${character.characterId}`}
            >
              {t(dryRun.isPending && simulatingCharacterId === character.characterId ? 'Simulando…' : 'Simular')}
            </button>
          </div>
        ))}
        <div className="p-4">
          <h3 className="text-sm font-semibold">{t("Mensajes autónomos")}</h3>
          <p className="mt-1 text-xs text-muted-foreground">{t("Elegí qué personajes pueden responder mensajes privados automáticamente. Este permiso es independiente de la actividad social.")}</p>
        </div>
        {settings?.characters.map((character) => (
          <div key={`dm-${character.characterId}`} className="p-4">
            <div className="flex items-center gap-3">
              <div className="min-w-0 flex-1">
                <div className="truncate text-sm font-semibold">{character.displayName}</div>
                <div className="mt-1 text-xs text-muted-foreground">@{character.username}</div>
              </div>
              <Switch
                checked={character.dmEnabled}
                disabled={update.isPending && updatingControl === `dm:${character.characterId}`}
                onCheckedChange={(enabled) => setCharacter(character.characterId, enabled, "dm")}
                aria-label={`${t("Mensajes autónomos para")} ${character.displayName}`}
                data-testid={`switch-autonomy-dm-${character.characterId}`}
              />
            </div>
            {character.dmEnabled && dmDrafts[character.characterId] && (
              <div className="mt-3 space-y-3">
                <label className="block text-xs font-medium">
                  {t("Frecuencia de mensajes")}
                  <select
                    className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm"
                    value={dmDrafts[character.characterId].dmFrequency}
                    onChange={(event) => setDmDrafts((old) => ({ ...old, [character.characterId]: { ...old[character.characterId], dmFrequency: event.target.value as "rarely" | "sometimes" | "frequently" } }))}
                  >
                    <option value="rarely">{t("Rara vez")}</option>
                    <option value="sometimes">{t("A veces")}</option>
                    <option value="frequently">{t("Frecuentemente")}</option>
                  </select>
                </label>
                <label className="block text-xs font-medium">
                  {t("Tipo de mensajes preferido")}
                  <select
                    className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm"
                    value={dmDrafts[character.characterId].dmMediaPreference === "voice" ? "text" : dmDrafts[character.characterId].dmMediaPreference}
                    onChange={(event) => setDmDrafts((old) => ({ ...old, [character.characterId]: { ...old[character.characterId], dmMediaPreference: event.target.value as "text" | "mixed" | "voice" } }))}
                  >
                    <option value="text">{t("Solo texto")}</option>
                    <option value="mixed">{t("Texto y ocasionalmente fotos (cuando estén habilitadas y dentro de tu plan)")}</option>
                  </select>
                </label>
                <label className="block text-xs font-medium">
                  {t("Indicaciones para la IA")}
                  <textarea
                    className="mt-1 block w-full rounded-lg border border-border bg-background p-2 text-sm"
                    rows={3}
                    maxLength={600}
                    placeholder={t("Ej.: escribime espontáneamente, sin horarios fijos y con mensajes cortos.")}
                    value={dmDrafts[character.characterId].dmInstructions}
                    onChange={(event) => setDmDrafts((old) => ({ ...old, [character.characterId]: { ...old[character.characterId], dmInstructions: event.target.value } }))}
                  />
                </label>
                <p className="text-xs text-muted-foreground">{t("Las fotos estarán disponibles cuando se habilite la función y respetarán el límite diario de tu plan. Los audios requieren habilitación específica y no pueden solicitarse libremente.")}</p>
                <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" disabled={update.isPending} onClick={() => saveDmPreferences(character.characterId)}>{t("Guardar preferencias")}</button>
              </div>
            )}
          </div>
        ))}
      </div>

      {previewError && <div role="alert" className="mt-3 rounded-xl border border-destructive/40 bg-destructive/10 p-4 text-xs" data-testid="autonomy-dry-run-error"><p className="font-semibold">{t("La simulación no se completó.")}</p><p className="mt-1">{t('Código:')} <code>{previewError}</code>. {t("No se ejecutó ninguna acción social.")}</p><button type="button" className="mt-2 underline" onClick={() => navigator.clipboard?.writeText(previewError)}>{t("Copiar código de error")}</button></div>}
      {latest && (
        <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4" aria-live="polite" data-testid="autonomy-dry-run-result">
          <div className="flex items-start justify-between gap-3">
            <div className="text-sm font-semibold">
              {t(labels[latest.status])} · {latest.preview
                ? latest.preview.decision.action === "draft" ? t("borrador de texto")
                  : latest.preview.decision.action === "like" ? t("me gusta propuesto")
                    : latest.preview.decision.action === "react" ? `${t("reacción propuesta")} ${latest.preview.decision.reaction ?? ""}`
                      : t("no actuar")
                : t("sin llamada al modelo")}
            </div>
            <span className={cn("rounded-full bg-secondary px-2.5 py-1 text-[10px] font-semibold text-muted-foreground")}>
              {t("Solo preview")}
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
            {t("No se publicó, envió, gustó ni reaccionó nada. Ejecución en vivo: desactivada.")}
          </p>
        </div>
      )}
    </section>
  );
}
