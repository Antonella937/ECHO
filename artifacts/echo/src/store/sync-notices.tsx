import { useState } from 'react';
import type { UniverseSync, SyncView } from './synchronization';
import type { Resolutions } from './merge';

const preview = (value: unknown) => value === undefined ? 'Eliminado' :
  (typeof value === 'string' ? value : JSON.stringify(value)).slice(0, 240);

export function SyncNotices({ view, engine }: { view: SyncView; engine: UniverseSync | null }) {
  const [choices, setChoices] = useState<Resolutions>({});
  const [confirmImport, setConfirmImport] = useState(false);
  const [deferred, setDeferred] = useState(false);
  const download = () => {
    const url = URL.createObjectURL(new Blob([JSON.stringify(view.state, null, 2)], { type: 'application/json' }));
    const a = document.createElement('a'); a.href = url; a.download = 'echo-recuperacion.json'; a.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
  };
  return <>
    {view.importing && <div className="fixed inset-0 z-[130] grid place-items-center bg-background/90 px-6" role="status">
      <p className="rounded-2xl border border-border bg-card p-6">Preparando la importación privada. La copia original sigue intacta…</p>
    </div>}
    {(view.error || (view.legacyAvailable && !deferred) || view.importVerified) && (
      <aside className="fixed inset-x-3 bottom-24 z-50 mx-auto max-w-md rounded-2xl border border-primary/40 bg-card p-4 text-sm shadow-xl" aria-label="Estado de sincronización">
        {view.error ? <>
          <p role="alert">{view.error}</p>
          <p className="mt-2 text-xs text-muted-foreground">No borres los datos de este navegador. Los cambios pendientes se conservan por propietario.</p>
          <button className="mt-3 rounded-xl bg-primary px-3 py-2 text-primary-foreground" onClick={() => void engine?.sync()}>Reintentar</button>
          <button className="ml-3 underline" onClick={download}>Descargar copia</button>
        </> : view.legacyAvailable ? <>
          <p>Hay datos de la versión anterior en este navegador.</p>
          <p className="mt-1 text-xs text-muted-foreground">Puedes combinarlos con esta cuenta sin borrar la copia original.</p>
          <button className="mt-3 rounded-xl bg-primary px-3 py-2 text-primary-foreground" onClick={() => setConfirmImport(true)}>Revisar importación</button>
          <button className="ml-3 underline" onClick={() => setDeferred(true)}>Más tarde</button>
        </> : <p role="status">Importación verificada en servidor, incluidas las fotos. La copia local original sigue intacta.</p>}
      </aside>
    )}
    {confirmImport && (
      <div className="fixed inset-0 z-[110] grid place-items-center bg-background/90 px-5" role="dialog" aria-modal="true" aria-labelledby="import-title">
        <div className="max-w-md rounded-3xl border border-border bg-card p-6">
          <h2 id="import-title" className="text-lg font-semibold">Importar a tu cuenta actual</h2>
          <p className="mt-3 text-sm text-muted-foreground">Confirma que estos datos del navegador son tuyos. Se combinarán por identificador, sin duplicar publicaciones, comentarios, historias ni mensajes. Si hay dos versiones incompatibles, podrás elegir. El original local no se borrará.</p>
          <button className="mt-5 rounded-xl bg-primary px-4 py-3 text-primary-foreground" onClick={() => {
            setConfirmImport(false); void engine?.importLegacy();
          }}>Importar y combinar</button>
          <button className="ml-4 underline" onClick={() => setConfirmImport(false)}>Cancelar</button>
        </div>
      </div>
    )}
    {!!view.conflicts.length && (
      <div className="fixed inset-0 z-[120] overflow-auto bg-background/95 p-5" role="dialog" aria-modal="true" aria-labelledby="conflict-title">
        <div className="mx-auto max-w-lg py-8">
          <h2 id="conflict-title" className="text-xl font-semibold">Hay cambios que necesitan tu decisión</h2>
          <p className="mt-3 text-sm text-muted-foreground">No se sobrescribió el servidor. Elige qué versión conservar en cada diferencia. La copia de recuperación y el original de la importación permanecen en este dispositivo.</p>
          {view.conflicts.map(c => <fieldset key={c.path} className="mt-5 rounded-2xl border border-border p-4">
            <legend className="break-all px-2 text-xs text-primary">{c.path}</legend>
            {(['local', 'remote'] as const).map(side => <label key={side} className="my-2 flex items-start gap-3 rounded-xl bg-secondary p-3">
              <input type="radio" name={c.path} checked={choices[c.path] === side} onChange={() => setChoices(v => ({ ...v, [c.path]: side }))} />
              <span className="min-w-0 break-words text-sm"><strong>{side === 'local' ? 'Este dispositivo' : 'Servidor'}</strong><span className="mt-1 block text-xs">{preview(c[side])}</span></span>
            </label>)}
          </fieldset>)}
          <button disabled={view.conflicts.some(c => !choices[c.path]) || view.busy}
            className="mt-6 w-full rounded-2xl bg-primary p-4 font-semibold text-primary-foreground disabled:opacity-40"
            onClick={() => { engine?.resolve(choices); setChoices({}); }}>Combinar con mis elecciones</button>
          <button className="mt-4 w-full underline" onClick={download}>Descargar copia antes de resolver</button>
        </div>
      </div>
    )}
  </>;
}
