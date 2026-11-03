import { useRef, useState } from 'react';
import { useUser } from '@clerk/react';
import { Check, ChevronRight, Layers, Plus } from 'lucide-react';
import { useCreateCreatorUniverse, useGetCreatorAccount, useListCreatorUniverses } from '@workspace/api-client-react';
import { useSocial } from '@/store/social-store';
import { getActiveUniverseId, setActiveUniverseId } from '@/store/persistence';
import { activateOwnedUniverse, newUniverseInput } from '@/lib/universe-navigation';
import { Field, inputCls } from './field';
import { Sheet } from './sheet';

export function UniverseSelector() {
  const { user, isSignedIn } = useUser();
  const { actions, state } = useSocial();
  const ownerRef = useRef(user?.id);
  ownerRef.current = user?.id;
  const [open, setOpen] = useState(false);
  const [creating, setCreating] = useState(false);
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
  const capacity = account.data;
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
      setError(cause instanceof Error ? cause.message : 'No se pudo abrir el universo. Inténtalo de nuevo.');
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
        onClick={() => { setCreating(false); setError(null); setName(''); setDisplayName(''); setUsername(''); setOpen(true); }}>
        <Layers className="h-4 w-4 shrink-0 text-muted-foreground" />
        <span className="min-w-0 flex-1">
          <span className="block text-sm font-semibold">Universos</span>
          <span className="block truncate text-xs text-muted-foreground">{state.creatorSetup?.universeName || 'Mi universo'}</span>
        </span>
        <ChevronRight className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
      <Sheet open={open} onClose={close} title={creating ? 'Crear universo' : 'Tus universos'} testId="sheet-universes">
        {!creating ? (
          <div className="space-y-3">
            {list.isLoading && <p role="status" className="text-sm text-muted-foreground">Cargando universos…</p>}
            {list.isError && <div role="alert" className="text-sm text-destructive">
              No se pudieron cargar tus universos.
              <button type="button" className="ml-2 min-h-11 underline" onClick={() => void list.refetch()}>Reintentar</button>
            </div>}
            {list.data?.map(universe => (
              <button type="button" key={universe.universeId} className={buttonCls}
                disabled={busy || universe.universeId === activeId}
                aria-current={universe.universeId === activeId ? 'true' : undefined}
                onClick={() => void run(() => activate(universe.universeId, list.data!.map(item => item.universeId)))}>
                <span className="min-w-0 flex-1">
                  <span className="block break-words font-semibold">{universe.name}</span>
                  <span className="text-xs text-muted-foreground">{universe.characterCount} personajes{universe.universeId === activeId ? ' · Activo' : ''}</span>
                </span>
                {universe.universeId === activeId && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
            ))}
            {list.isSuccess && list.data.length === 0 && <p className="text-sm text-muted-foreground">No hay universos disponibles.</p>}
            <button type="button" className={buttonCls} disabled={busy || !list.isSuccess || !hasCapacity}
              onClick={() => { setError(null); setCreating(true); }}>
              <Plus className="h-4 w-4 shrink-0" /> Crear universo
            </button>
            {account.isLoading && <p className="text-xs text-muted-foreground">Consultando capacidad…</p>}
            {account.isError && <p role="alert" className="text-sm text-destructive">
              No se pudo consultar la capacidad.
              <button type="button" className="ml-2 min-h-11 underline" onClick={() => void account.refetch()}>Reintentar</button>
            </p>}
            {capacity && <p className="text-xs text-muted-foreground">
              {capacity.universeCount} de {capacity.maxUniverses} universos · {capacity.characterCount} de {capacity.maxCharacters} personajes
              {!hasCapacity && '. No hay capacidad disponible para un universo con su primer personaje.'}
            </p>}
          </div>
        ) : (
          <form onSubmit={event => {
            event.preventDefault();
            void run(async () => {
              if (!capacity || !hasCapacity) throw new Error('No hay capacidad disponible.');
              const data = newUniverseInput({ plan: capacity.plan, universeName: name, displayName, username, bio: '' });
              await actions.retrySync();
              if (ownerRef.current !== ownerId) throw new Error('La sesión cambió.');
              const created = await create.mutateAsync({ data });
              // Already flushed before creation; do not introduce a second write after it.
              await activate(created.universeId, [created.universeId], async () => {});
            });
          }}>
            <Field id="new-universe-name" label="Nombre del universo">
              <input id="new-universe-name" className={inputCls} value={name} maxLength={60} required disabled={busy} onChange={e => setName(e.target.value)} />
            </Field>
            <Field id="new-universe-character" label="Primer personaje">
              <input id="new-universe-character" className={inputCls} value={displayName} maxLength={80} required disabled={busy} onChange={e => setDisplayName(e.target.value)} />
            </Field>
            <Field id="new-universe-username" label="Usuario del personaje">
              <input id="new-universe-username" className={inputCls} value={username} maxLength={31} required disabled={busy} autoCapitalize="none" autoCorrect="off" onChange={e => setUsername(e.target.value)} />
            </Field>
            <div className="mt-5 flex gap-2">
              <button type="button" className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-semibold" disabled={busy} onClick={() => setCreating(false)}>Volver</button>
              <button type="submit" className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-50" disabled={busy}>Crear universo</button>
            </div>
          </form>
        )}
        {busy && <p role="status" className="mt-3 text-sm text-muted-foreground">Guardando y abriendo universo…</p>}
        {error && <p role="alert" className="mt-3 break-words text-sm text-destructive">{error}</p>}
      </Sheet>
    </>
  );
}
