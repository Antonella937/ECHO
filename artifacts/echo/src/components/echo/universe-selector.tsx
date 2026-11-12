import { useEffect, useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { Check, ChevronRight, Layers, Plus } from 'lucide-react';
import { customFetch, useCreateCreatorUniverse, useGetCreatorAccount, useListCreatorUniverses, useManageCreatorUniverse, type CreatorUniverseSummary, type UniverseManagementInput } from '@workspace/api-client-react';
import { useSocial } from '@/store/social-store';
import { getActiveUniverseId, setActiveUniverseId } from '@/store/persistence';
import { activateOwnedUniverse, newUniverseInput } from '@/lib/universe-navigation';
import { Field, inputCls } from './field';
import { Sheet } from './sheet';
import { UniverseManagementForm } from './universe-management-form';
import { useUniverseText } from '@/lib/universe-translations';

export function UniverseSelector() {
  const t = useUniverseText();
  const { user, isSignedIn } = useUser();
  const { actions, state } = useSocial();
  const ownerRef = useRef(user?.id);
  ownerRef.current = user?.id;
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
  const [management, setManagement] = useState<{ universe: CreatorUniverseSummary; action: UniverseManagementInput['action'] } | null>(null);
  const [busy, setBusy] = useState(false);
  const working = useRef(false);
  const [error, setError] = useState<string | null>(null);
  const [name, setName] = useState('');
  const [displayName, setDisplayName] = useState('');
  const [username, setUsername] = useState('');
  const ownerId = user?.id ?? '';
  const activeId = ownerId ? getActiveUniverseId(ownerId) : 'primary';
  const enabled = open && Boolean(isSignedIn);
  const list = useListCreatorUniverses({ universeId: activeId }, {
    query: { enabled, queryKey: ['universe-selector', ownerId, activeId], staleTime: 0 },
  });
  const account = useGetCreatorAccount({
    query: { enabled, queryKey: ['universe-selector-capacity', ownerId], staleTime: 0 },
  });
  const create = useCreateCreatorUniverse();
  const manage = useManageCreatorUniverse();
  const availableIds = (list.data ?? []).filter(item => !item.archived).map(item => item.universeId);
  const capacity = account.data;
  const [lifetimeAccess, setLifetimeAccess] = useState<'owner_lifetime' | 'founder_lifetime' | null>(null);
  useEffect(() => {
    if (!open || !isSignedIn) return;
    let cancelled = false;
    void customFetch<{ lifetimeAccess?: 'owner_lifetime' | 'founder_lifetime' | null; billingExempt?: boolean }>('/api/account/entitlements', { responseType: 'json' })
      .then(result => { if (!cancelled) setLifetimeAccess(result.billingExempt ? result.lifetimeAccess ?? null : null); })
      .catch(() => { if (!cancelled) setLifetimeAccess(null); });
    return () => { cancelled = true; };
  }, [open, isSignedIn, ownerId]);
  const lifetimeUnlimited = lifetimeAccess === 'owner_lifetime' || lifetimeAccess === 'founder_lifetime';
  const hasCapacity = Boolean(capacity && capacity.universeCount < capacity.maxUniverses &&
    capacity.characterCount < capacity.maxCharacters);
  const buttonCls = 'flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border p-3 text-left text-sm hover:bg-secondary disabled:opacity-50';

  const run = async (operation: () => Promise<void>) => {
    if (working.current) return;
    working.current = true;
    setBusy(true);
    setError(null);
    try { await operation(); }
    catch (cause) {
      setError(cause instanceof Error ? cause.message : t('No se pudo abrir el universo. Inténtalo de nuevo.'));
    } finally {
      working.current = false;
      setBusy(false);
    }
  };
  const activate = (universeId: string, allowedIds: string[], flush = actions.retrySync) =>
    activateOwnedUniverse({
      ownerId, universeId, allowedIds,
      isCurrentOwner: () => Boolean(ownerId && ownerRef.current === ownerId),
      flush, select: setActiveUniverseId,
      reload: () => window.location.replace(import.meta.env.BASE_URL),
    });
  const close = () => { if (!working.current) setOpen(false); };

  return (
    <>
      <button type="button" className="mt-3 flex min-h-12 w-full items-center gap-3 rounded-2xl border border-border bg-card/60 p-4 text-left"
        data-testid="button-universe-selector"
        onClick={() => { setManagement(null); setCreating(false); setError(null); setName(''); setDisplayName(''); setUsername(''); setOpen(true); }}>
        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">{t("Universos")}</span>
          <span className="block truncate text-xs text-muted-foreground">{state.creatorSetup?.universeName || 'Mi universo'}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <Sheet open={open} onClose={close} title={t(management ? 'Gestionar universo' : creating ? 'Crear universo' : 'Tus universos')} testId="sheet-universes">
        {management ? <UniverseManagementForm key={`${management.universe.universeId}:${management.action}:${management.universe.revision}`}
          universe={management.universe} action={management.action} busy={busy}
          cancel={() => { setManagement(null); setError(null); }}
          submit={data => void run(async () => {
            await actions.retrySync();
            if (ownerRef.current !== ownerId) throw new Error(t('La sesión cambió.'));
            const result = await manage.mutateAsync({ universeId: management.universe.universeId, data });
            if (ownerRef.current !== ownerId) throw new Error('La sesión cambió.');
            if (management.universe.universeId === activeId) {
              const next = result.archived || result.deleted ? result.fallbackUniverseId : activeId;
              if (!next) throw new Error(t('No hay otro universo disponible.'));
              await activate(next, [next], async () => {});
              return;
            }
            setManagement(null);
            await Promise.all([list.refetch(), account.refetch()]);
          })} /> : !creating ? (
          <div className="space-y-3">
            {list.isLoading && <p role="status" className="text-sm text-muted-foreground">{t("Cargando universos…")}</p>}
            {list.isError && <div role="alert" className="text-sm text-destructive">
              No se pudieron cargar tus universos.
              <button type="button" className="ml-2 min-h-11 underline" onClick={() => void list.refetch()}>{t("Reintentar")}</button>
            </div>}
            {list.data?.map(universe => (
              <div key={universe.universeId}>
              <button type="button" className={buttonCls}
                disabled={busy || universe.archived || universe.universeId === activeId}
                aria-current={universe.universeId === activeId ? 'true' : undefined}
                onClick={() => void run(() => activate(universe.universeId, availableIds))}>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold">{universe.name}</span>
                  <span className="text-xs text-muted-foreground">{universe.characterCount} {t('personajes')}{universe.archived ? ` · ${t('Archivado')}` : universe.universeId === activeId ? ` · ${t('Activo')}` : ''}</span>
                  {universe.description && <span className="block break-words text-xs text-muted-foreground">{universe.description}</span>}
                </span>
                {universe.universeId === activeId && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
              <div className="mt-1 flex flex-wrap gap-2">
                {(['edit', universe.archived ? 'restore' : 'archive', 'delete'] as const).map(action => <button key={action} type="button"
                  className="tap min-h-11 rounded-xl bg-secondary px-3 text-xs disabled:opacity-50"
                  disabled={busy || (!universe.archived && availableIds.length <= 1 && action !== 'edit')}
                  aria-label={`${t(action === 'edit' ? 'Editar' : action === 'archive' ? 'Archivar' : action === 'restore' ? 'Restaurar' : 'Eliminar')} ${universe.name}`}
                  onClick={() => void run(async () => {
                    await actions.retrySync();
                    const fresh = await list.refetch();
                    if (ownerRef.current !== ownerId) throw new Error('La sesión cambió.');
                    const current = fresh.data?.find(item => item.universeId === universe.universeId);
                    if (!current) throw new Error(t('El universo ya no está disponible.'));
                    setManagement({ universe: current, action });
                  })}>
                  {t(action === 'edit' ? 'Editar' : action === 'archive' ? 'Archivar' : action === 'restore' ? 'Restaurar' : 'Eliminar')}
                </button>)}
              </div>
              </div>
            ))}
            {availableIds.length === 1 && <p className="text-xs text-muted-foreground">{t("Conserva al menos un universo sin archivar. Crea o restaura otro para poder archivar o eliminar el último disponible.")}</p>}
            {list.isSuccess && list.data.length === 0 && <p className="text-sm text-muted-foreground">{t("No hay universos disponibles.")}</p>}
            <button type="button" className={buttonCls} disabled={busy || !list.isSuccess || !hasCapacity}
              onClick={() => { setError(null); setCreating(true); }}>
              <Plus className="h-4 w-4 shrink-0" /> {t("Crear universo")}
            </button>
            {account.isLoading && <p className="text-xs text-muted-foreground">{t("Consultando capacidad…")}</p>}
            {account.isError && <p role="alert" className="text-sm text-destructive">
              No se pudo consultar la capacidad.
              <button type="button" className="ml-2 min-h-11 underline" onClick={() => void account.refetch()}>{t("Reintentar")}</button>
            </p>}
            {capacity && <p className="text-xs text-muted-foreground">
              {capacity.universeCount} / {lifetimeUnlimited ? "∞" : capacity.maxUniverses} {t("universos")} · {capacity.characterCount} / {lifetimeUnlimited ? "∞" : capacity.maxCharacters} {t("personajes")}
              {!hasCapacity && t('. No hay capacidad disponible para un universo con su primer personaje.')}
            </p>}
          </div>
        ) : (
          <form onSubmit={event => {
            event.preventDefault();
            void run(async () => {
              if (!capacity || !hasCapacity) throw new Error(t('No hay capacidad disponible.'));
              const data = newUniverseInput({ plan: capacity.plan === 'free' ? 'free' : 'creator', universeName: name, displayName, username, bio: '' });
              await actions.retrySync();
              if (ownerRef.current !== ownerId) throw new Error('La sesión cambió.');
              const created = await create.mutateAsync({ data });
              // Already flushed before creation; do not introduce a second write after it.
              await activate(created.universeId, [created.universeId], async () => {});
            });
          }}>
            <Field id="new-universe-name" label={t("Nombre del universo")}>
              <input id="new-universe-name" className={inputCls} value={name} maxLength={60} required disabled={busy} onChange={e => setName(e.target.value)} />
            </Field>
            <Field id="new-universe-character" label={t("Primer personaje")}>
              <input id="new-universe-character" className={inputCls} value={displayName} maxLength={80} required disabled={busy} onChange={e => setDisplayName(e.target.value)} />
            </Field>
            <Field id="new-universe-username" label={t("Usuario del personaje")}>
              <input id="new-universe-username" className={inputCls} value={username} maxLength={31} required disabled={busy} autoCapitalize="none" autoCorrect="off" onChange={e => setUsername(e.target.value)} />
            </Field>
            <div className="mt-5 flex gap-2">
              <button type="button" className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-semibold" disabled={busy} onClick={() => setCreating(false)}>{t("Volver")}</button>
              <button type="submit" className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={busy}>{t("Crear universo")}</button>
            </div>
          </form>
        )}
        {busy && <p role="status" className="mt-3 text-sm text-muted-foreground">{t("Guardando cambios…")}</p>}
        {error && <p role="alert" className="mt-3 break-words text-sm text-destructive">{error}</p>}
      </Sheet>
    </>
  );
}
