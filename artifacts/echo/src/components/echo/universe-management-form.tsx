import { useState } from 'react';
import type { CreatorUniverseSummary, UniverseManagementInput } from '@workspace/api-client-react';
import { Field, inputCls } from './field';

export function UniverseManagementForm({ universe, action, busy, cancel, submit }: {
  universe: CreatorUniverseSummary;
  action: UniverseManagementInput['action'];
  busy: boolean;
  cancel: () => void;
  submit: (data: UniverseManagementInput) => void;
}) {
  const [name, setName] = useState(universe.name);
  const [description, setDescription] = useState(universe.description ?? '');
  const [confirmation, setConfirmation] = useState('');
  const phrase = `ELIMINAR ${universe.name}`;
  return <form onSubmit={event => {
    event.preventDefault();
    submit({ action, expectedRevision: universe.revision,
      ...(action === 'edit' ? { name: name.trim(), description: description.trim() } : {}),
      ...(action === 'delete' ? { confirmationText: confirmation } : {}),
    });
  }}>
    {action === 'edit' ? <>
      <Field id="universe-edit-name" label="Nombre del universo">
        <input id="universe-edit-name" className={inputCls} value={name} maxLength={60} required disabled={busy} onChange={event => setName(event.target.value)} />
      </Field>
      <Field id="universe-edit-description" label="Descripción">
        <textarea id="universe-edit-description" className={`${inputCls} min-h-24 py-3`} value={description} maxLength={500} disabled={busy} onChange={event => setDescription(event.target.value)} />
      </Field>
    </> : <p className="mb-4 break-words text-sm text-muted-foreground">
      {action === 'delete'
        ? `Eliminar «${universe.name}» es irreversible. Perderás sus personajes, publicaciones, Stories, mensajes y memoria. Los demás universos no se eliminarán.`
        : action === 'archive'
          ? `Archivar «${universe.name}» conserva todo su contenido. No se podrá abrir hasta restaurarlo.`
          : `Restaurar «${universe.name}» permite volver a abrirlo con su contenido conservado.`}
    </p>}
    {action === 'delete' && <Field id="universe-delete-confirmation" label={`Escribe ${phrase}`}>
      <input id="universe-delete-confirmation" className={inputCls} value={confirmation} autoComplete="off" disabled={busy} onChange={event => setConfirmation(event.target.value)} />
    </Field>}
    <div className="mt-5 flex gap-2">
      <button type="button" className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-semibold" disabled={busy} onClick={cancel}>Cancelar</button>
      <button type="submit" className={`h-12 flex-1 rounded-2xl text-sm font-semibold disabled:opacity-50 ${action === 'delete' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}
        disabled={busy || (action === 'delete' && confirmation !== phrase) || (action === 'edit' && !name.trim())}>
        {action === 'edit' ? 'Guardar cambios' : action === 'archive' ? 'Archivar universo' : action === 'restore' ? 'Restaurar universo' : 'Eliminar definitivamente'}
      </button>
    </div>
  </form>;
}
