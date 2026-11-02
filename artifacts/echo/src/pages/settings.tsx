import { useEffect, useState } from 'react';
import { Check, HardDrive, Info, RotateCcw } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { CharacterAvatar } from '@/components/echo/avatar';
import { Sheet } from '@/components/echo/sheet';
import { characterProvider, imageProvider } from '@/domain/providers';
import { estimateUsage, getBackend } from '@/store/persistence';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

export default function SettingsPage() {
  const { state, me, actions, storageError, lastSavedAt } = useSocial();
  const back = useBack();
  const [usage, setUsage] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);

  useEffect(() => {
    estimateUsage().then(setUsage);
  }, [lastSavedAt]);

  return (
    <div>
      <TopBar title="Ajustes" onBack={back} />
      <div className="px-4 pb-12 pt-5">
        <section aria-labelledby="identity-h">
          <h2 id="identity-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Identidad activa</h2>
          <p className="mt-1.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
            Todo lo que publiques, comentes o envíes saldrá con este perfil.
          </p>
          <div className="mt-3 flex flex-col gap-2" role="radiogroup" aria-label="Identidad activa">
            {state.characters.map((c) => {
              const active = c.id === me.id;
              return (
                <button
                  key={c.id}
                  role="radio"
                  aria-checked={active}
                  onClick={() => {
                    if (active) return;
                    actions.switchIdentity(c.id);
                    toast({ title: `Ahora publicas como ${c.name}` });
                  }}
                  className={cn(
                    'flex items-center gap-3 rounded-2xl border p-3 text-left transition-colors',
                    active ? 'border-primary/50 bg-accent/40' : 'border-border hover:bg-secondary/60',
                  )}
                  data-testid={`radio-identity-${c.id}`}
                >
                  <CharacterAvatar character={c} size={46} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{c.name}</div>
                    <div className="truncate text-xs text-muted-foreground">@{c.handle} · {c.occupation}</div>
                  </div>
                  <span className={cn('grid h-6 w-6 place-items-center rounded-full border', active ? 'border-primary bg-primary text-primary-foreground' : 'border-[hsl(240_4%_26%)]')}>
                    {active && <Check className="h-3.5 w-3.5" strokeWidth={3} />}
                  </span>
                </button>
              );
            })}
          </div>
        </section>

        <section className="mt-9" aria-labelledby="about-h">
          <h2 id="about-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sobre este prototipo</h2>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4 text-[13px] leading-relaxed text-muted-foreground" data-testid="text-prototype-notice">
            <p className="flex gap-2.5"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
              <span>Los datos se guardan solo en este dispositivo. Si borras los datos del navegador, se pierden.</span></p>
            <p className="mt-2.5 pl-[26px]">Los personajes y su actividad son simulados: no hay IA conectada ni respuestas en vivo.</p>
            <p className="mt-2.5 pl-[26px]">Las fotos de ejemplo son ilustrativas y no muestran a personas reales.</p>
            <p className="mt-2.5 pl-[26px]">Todavía no existe un inicio de sesión seguro. Cualquiera con acceso a este navegador puede cambiar de identidad.</p>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="storage-h">
          <h2 id="storage-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Almacenamiento</h2>
          <div className="mt-3 rounded-2xl border border-border p-4 text-[13px]">
            <div className="flex items-center gap-2.5">
              <HardDrive className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
              <span className="flex-1">{getBackend() === 'indexeddb' ? 'IndexedDB' : 'localStorage'}{usage ? ` · ${usage} usados` : ''}</span>
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', storageError ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground')} data-testid="status-storage">
                {storageError ? 'Error' : 'Guardado'}
              </span>
            </div>
            {storageError && <p role="alert" className="mt-3 text-destructive">{storageError}</p>}
            <p className="mt-3 text-muted-foreground">
              {state.posts.length} publicaciones · {state.stories.length} historias · {state.messages.length} mensajes
            </p>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="prov-h">
          <h2 id="prov-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Conexiones futuras</h2>
          <div className="mt-3 divide-y divide-border rounded-2xl border border-border text-[13px]">
            <Row label="Motor de personajes" value={characterProvider.label} />
            <Row label="Generación de imágenes" value={imageProvider.label} />
            {state.characters.map((c) => (
              <Row key={c.id} label={`Kin ID de ${c.name.split(' ')[0]}`} value={c.providerRef.externalId ?? 'Sin vincular'} />
            ))}
          </div>
        </section>

        <button
          onClick={() => setConfirmReset(true)}
          className="mt-9 flex h-12 w-full items-center justify-center gap-2 rounded-2xl border border-border text-sm font-medium text-muted-foreground hover:text-foreground"
          data-testid="button-reset"
        >
          <RotateCcw className="h-4 w-4" strokeWidth={1.8} /> Restaurar datos de ejemplo
        </button>
      </div>

      <Sheet open={confirmReset} onClose={() => setConfirmReset(false)} title="¿Restaurar ECHO?">
        <p className="text-sm text-muted-foreground">Se borrarán tus publicaciones, mensajes y cambios en este dispositivo, y volverás a ser Nela.</p>
        <div className="mt-5 flex gap-2 pb-2">
          <button onClick={() => setConfirmReset(false)} className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-medium" data-testid="button-cancel-reset">Cancelar</button>
          <button
            onClick={async () => {
              await actions.resetAll();
              setConfirmReset(false);
              toast({ title: 'Datos restaurados' });
            }}
            className="h-12 flex-1 rounded-2xl bg-destructive text-sm font-semibold text-destructive-foreground"
            data-testid="button-confirm-reset"
          >
            Restaurar
          </button>
        </div>
      </Sheet>
    </div>
  );
}

function Row({ label, value }: { label: string; value: string }) {
  return (
    <div className="flex items-center justify-between gap-4 px-4 py-3">
      <span className="text-muted-foreground">{label}</span>
      <span className="text-right">{value}</span>
    </div>
  );
}
