import { ChevronDown } from "lucide-react";
import { useAdvancedSettingsText } from '@/lib/advanced-settings-translations';
import { useState } from "react";
import { useEffect } from "react";
import { useUser } from "@clerk/react";
import { useQueryClient } from "@tanstack/react-query";
import {
  getGetAutonomySettingsQueryKey,
  useGetAutonomySettings,
  useUpdateAutonomySettings,
} from "@workspace/api-client-react";
import { Switch } from "@/components/ui/switch";
import { toast } from "@/hooks/use-toast";
import { getActiveUniverseId } from "@/store/persistence";

export function AutonomySettingsSection() {
  const t = useAdvancedSettingsText();
  const { user } = useUser();
  const universeId = user?.id ? getActiveUniverseId(user.id) : "primary";
  const client = useQueryClient();
  const query = useGetAutonomySettings({ universeId });
  const update = useUpdateAutonomySettings();
  const [updatingControl, setUpdatingControl] = useState<string | null>(null);
  const settings = query.data;
  const [dmDrafts, setDmDrafts] = useState<Record<string, { dmFrequency: "rarely" | "sometimes" | "frequently"; dmMediaPreference: "text" | "mixed" | "voice"; dmInstructions: string }>>({});
  useEffect(() => {
    if (!query.data) return;
    setDmDrafts(Object.fromEntries(query.data.characters.map((character) => [character.characterId, { dmFrequency: character.dmFrequency, dmMediaPreference: character.dmMediaPreference, dmInstructions: character.dmInstructions }])));
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

  return (
    <section className="mt-9" aria-labelledby="autonomy-h">
      <h2 id="autonomy-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">
        {t("Autonomía de texto")}
      </h2>
      <p className="mt-1.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
        {settings?.liveExecutionEnabled ? t("Beta privada: los personajes habilitados pueden actuar con IA de texto. La generación manual de imágenes está disponible; las acciones autónomas con imágenes se controlan por separado.") : t("La autonomía en vivo todavía no está habilitada para esta cuenta; las simulaciones son manuales.")}
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
        <details className="group" data-testid="details-social-autonomy"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>{t("Autonomía social")} · {settings?.characters.filter(c=>c.enabled).length ?? 0}/{settings?.characters.length ?? 0}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"/></summary><div className="divide-y divide-border border-t border-border"><div className="p-4">
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
          </div>
        ))}
        </div></details>
        <details className="group" data-testid="details-dm-autonomy"><summary className="flex min-h-12 cursor-pointer list-none items-center justify-between gap-3 p-4 text-sm font-semibold [&::-webkit-details-marker]:hidden"><span>{t("Mensajes autónomos")} · {settings?.characters.filter(c=>c.dmEnabled).length ?? 0}/{settings?.characters.length ?? 0}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground transition-transform group-open:rotate-180"/></summary><div className="divide-y divide-border border-t border-border"><div className="p-4">
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
                    value={dmDrafts[character.characterId].dmMediaPreference}
                    onChange={(event) => setDmDrafts((old) => ({ ...old, [character.characterId]: { ...old[character.characterId], dmMediaPreference: event.target.value as "text" | "mixed" | "voice" } }))}
                  >
                    <option value="text">{t("Solo texto")}</option>
                    <option value="voice">{t("Texto y notas de voz (solo con presupuesto de audio habilitado)")}</option>
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
                <p className="text-xs text-muted-foreground">{t("Las fotos y notas de voz autónomas respetan los permisos, preferencias y límites de tu plan. Los audios necesitan autorización y presupuesto habilitados.")}</p>
                <button type="button" className="rounded-lg bg-primary px-3 py-2 text-xs font-semibold text-primary-foreground disabled:opacity-50" disabled={update.isPending} onClick={() => saveDmPreferences(character.characterId)}>{t("Guardar preferencias")}</button>
              </div>
            )}
          </div>
        ))}
        </div></details>
      </div>

    </section>
  );
}
