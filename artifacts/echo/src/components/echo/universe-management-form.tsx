import { UniverseLoreSections } from './universe-lore-sections';
import { useState } from 'react';
import type { CreatorUniverseSummary, UniverseManagementInput } from '@workspace/api-client-react';
import { Field, inputCls } from './field';
import { useUniverseText } from '@/lib/universe-translations';

export function UniverseManagementForm({ universe, action, busy, cancel, submit }: {
  universe: CreatorUniverseSummary;
  action: UniverseManagementInput['action'];
  busy: boolean;
  cancel: () => void;
  submit: (data: UniverseManagementInput) => void;
}) {
  const t = useUniverseText();
  const [name, setName] = useState(universe.name);
  const [description, setDescription] = useState(universe.description ?? '');
  const [timeline, setTimeline] = useState(universe.timeline ?? '');
  const [confirmation, setConfirmation] = useState('');
  const phrase = `ELIMINAR ${universe.name}`;
  return <form onSubmit={event => {
    event.preventDefault();
    submit({ action, expectedRevision: universe.revision,
      ...(action === 'edit' ? { name: name.trim(), description: description.trim(), timeline: timeline.trim() } : {}),
      ...(action === 'delete' ? { confirmationText: confirmation } : {}),
    });
  }}>
    {action === 'edit' ? <>
      <Field id="universe-edit-name" label={t("Nombre del universo")}>
        <input id="universe-edit-name" className={inputCls} value={name} maxLength={60} required disabled={busy} onChange={event => setName(event.target.value)} />
      </Field>
      <UniverseLoreSections prefix="universe-edit-lore" value={description} onChange={setDescription} disabled={busy} />
      <Field id="universe-edit-timeline" label={t("Cronología del universo (acontecimientos)") }>
        <textarea id="universe-edit-timeline" className={`${inputCls} min-h-28 py-3`} value={timeline} maxLength={4000} disabled={busy} onChange={event => setTimeline(event.target.value)} placeholder={t("Qué ocurrió, cuándo y qué cambió para los personajes…")} />
      </Field>
      <p className="mt-1 text-xs text-muted-foreground">{t("Este contexto orienta a los personajes del universo. Cada personaje conserva sus propios conocimientos, recuerdos y personalidad. Hasta 8.000 caracteres.")}</p>
    </> : <p className="mb-4 break-words text-sm text-muted-foreground">
      {action === 'delete'
        ? t('Eliminar «{name}» es irreversible. Perderás sus personajes, publicaciones, Stories, mensajes y memoria. Los demás universos no se eliminarán.', { name: universe.name })
        : action === 'archive'
          ? t('Archivar «{name}» conserva todo su contenido. No se podrá abrir hasta restaurarlo.', { name: universe.name })
          : t('Restaurar «{name}» permite volver a abrirlo con su contenido conservado.', { name: universe.name })}
    </p>}
    {action === 'delete' && <Field id="universe-delete-confirmation" label={`${t("Escribe")} ${phrase}`}>
      <input id="universe-delete-confirmation" className={inputCls} value={confirmation} autoComplete="off" disabled={busy} onChange={event => setConfirmation(event.target.value)} />
    </Field>}
    <div className="mt-5 flex gap-2">
      <button type="button" className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-semibold" disabled={busy} onClick={cancel}>{t("Cancelar")}</button>
      <button type="submit" className={`h-12 flex-1 rounded-2xl text-sm font-semibold disabled:opacity-50 ${action === 'delete' ? 'bg-destructive text-destructive-foreground' : 'bg-primary text-primary-foreground'}`}
        disabled={busy || (action === 'delete' && confirmation !== phrase) || (action === 'edit' && !name.trim())}>
        {t(action === 'edit' ? 'Guardar cambios' : action === 'archive' ? 'Archivar universo' : action === 'restore' ? 'Restaurar universo' : 'Eliminar definitivamente')}
      </button>
    </div>
  </form>;
}
