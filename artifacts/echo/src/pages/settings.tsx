import { useClerk, useUser } from '@clerk/react';
import { Cloud, Info, LogOut } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { TopBar, useBack } from '@/components/echo/top-bar';
import { AccountManager } from '@/components/echo/account-manager';
import { characterProvider, imageProvider } from '@/domain/providers';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';

const basePath = import.meta.env.BASE_URL.replace(/\/$/, '');

export default function SettingsPage() {
  const { state, me, actions, storageError, lastSavedAt } = useSocial();
  const { user } = useUser();
  const { signOut } = useClerk();
  const back = useBack();

  return (
    <div>
      <TopBar title="Ajustes" onBack={back} />
      <div className="px-4 pb-12 pt-5">
        <section aria-labelledby="account-h">
          <h2 id="account-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Tu cuenta</h2>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4">
            <div className="text-sm font-semibold">{user?.fullName || 'Cuenta ECHO'}</div>
            <div className="mt-1 text-xs text-muted-foreground">{user?.primaryEmailAddress?.emailAddress || 'Sesión protegida'}</div>
            <button
              type="button"
              onClick={() => void signOut({ redirectUrl: basePath || '/' })}
              className="mt-4 flex h-10 items-center gap-2 rounded-xl border border-border px-3 text-xs font-semibold text-muted-foreground hover:text-foreground"
              data-testid="button-sign-out"
            >
              <LogOut className="h-4 w-4" /> Cerrar sesión
            </button>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="identity-h">
          <h2 id="identity-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Cuentas e identidad activa</h2>
          <p className="mt-1.5 px-1 text-[13px] leading-relaxed text-muted-foreground">
            Todo lo que publiques, comentes o envíes saldrá con este perfil.
          </p>
          <AccountManager />
        </section>

        <section className="mt-9" aria-labelledby="about-h">
          <h2 id="about-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Sobre ECHO</h2>
          <div className="mt-3 rounded-2xl border border-border bg-card/60 p-4 text-[13px] leading-relaxed text-muted-foreground" data-testid="text-prototype-notice">
            <p className="flex gap-2.5"><Info className="mt-0.5 h-4 w-4 shrink-0 text-primary" strokeWidth={1.8} />
              <span>Tu universo, publicaciones, imágenes, comentarios e historias se guardan en tu cuenta privada.</span></p>
            <p className="mt-2.5 pl-[26px]">Los personajes y su actividad son simulados: no hay IA conectada ni respuestas en vivo.</p>
            <p className="mt-2.5 pl-[26px]">Las fotos de ejemplo son ilustrativas y no muestran a personas reales.</p>
            <p className="mt-2.5 pl-[26px]">Solo tú puedes abrir este universo al iniciar sesión. Puedes cambiar manualmente la identidad activa en esta página.</p>
          </div>
        </section>

        <section className="mt-9" aria-labelledby="storage-h">
          <h2 id="storage-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Almacenamiento</h2>
          <div className="mt-3 rounded-2xl border border-border p-4 text-[13px]">
            <div className="flex items-center gap-2.5">
              <Cloud className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
              <span className="flex-1">Nube privada ECHO</span>
              <span className={cn('rounded-full px-2.5 py-1 text-[11px] font-semibold', storageError ? 'bg-destructive/15 text-destructive' : 'bg-secondary text-muted-foreground')} data-testid="status-storage">
                {storageError ? 'Pendiente' : 'Sincronizado'}
              </span>
            </div>
            {storageError && <p role="alert" className="mt-3 text-destructive">{storageError}</p>}
            <p className="mt-3 text-muted-foreground">
              {state.posts.length} publicaciones · {state.comments.length} comentarios · {state.messages.length} mensajes
            </p>
            {lastSavedAt && <p className="mt-1.5 text-xs text-muted-foreground">Última sincronización: {new Date(lastSavedAt).toLocaleString('es-ES')}</p>}
            {storageError && (
              <button
                type="button"
                onClick={() => void actions.retrySync().then(() => toast({ title: 'Universo sincronizado' })).catch(() => undefined)}
                className="mt-3 h-10 rounded-xl bg-primary px-4 text-xs font-semibold text-primary-foreground"
                data-testid="button-retry-sync"
              >
                Reintentar sincronización
              </button>
            )}
          </div>
        </section>

        <section className="mt-9" aria-labelledby="prov-h">
          <h2 id="prov-h" className="px-1 text-[11px] uppercase tracking-[0.18em] text-muted-foreground">Conexiones futuras</h2>
          <div className="mt-3 divide-y divide-border rounded-2xl border border-border text-[13px]">
            <Row label="Motor de personajes" value={characterProvider.label} />
            <Row label="Generación de imágenes" value={imageProvider.label} />
            {state.characters.filter((c) => !c.archived).map((c) => (
              <Row key={c.id} label={`Kin ID de ${c.name.split(' ')[0]}`} value={c.providerRef.externalId ?? 'Sin vincular'} />
            ))}
          </div>
        </section>

      </div>

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
