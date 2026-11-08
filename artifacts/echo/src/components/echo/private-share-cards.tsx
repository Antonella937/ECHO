import { useCreatorShareText } from '@/lib/creator-share-translations';
import React, { useEffect, useId, useState } from 'react';
import { customFetch } from '@workspace/api-client-react';
import { CharacterInitials, UniverseCover } from './visual-defaults';

export interface PrivateShareCharacter {
  id: string;
  name: string;
  imageSrc?: string | null;
}

export interface PrivateShareCardsProps {
  universeName: string;
  description?: string | null;
  creatorName?: string | null;
  characters: PrivateShareCharacter[];
  initialCharacterId?: string;
  universeId: string;
}

const SERIF = "'Instrument Serif', Georgia, serif";
const card = 'min-w-0 rounded-[18px] border border-[rgba(239,220,232,.12)] bg-[rgba(255,255,255,.025)] p-4 sm:p-5';
const overline = 'text-[9px] font-bold uppercase tracking-[.17em] text-[#d9a8bd]';
const disabledBtn =
  'tap inline-flex min-h-11 flex-1 items-center justify-center rounded-full border border-[rgba(239,220,232,.14)] bg-transparent px-3 text-[11px] font-semibold text-[#cbb9c5] opacity-55 cursor-not-allowed';

function LinkRow({ label, link }: { label: string; link?: string }) {
  const t = useCreatorShareText();
  return (
    <div className="mt-3 flex min-w-0 items-center gap-2 rounded-xl border border-dashed border-[rgba(217,168,189,.22)] px-3 py-2">
      <span className="text-[9px] uppercase tracking-[.13em] text-[#8f8790]">{t("Enlace")}</span>
      <span className="min-w-0 flex-1 text-[11px] text-[#8f8790]" aria-label={`${t("Enlace de")} ${t(label)} ${t("no disponible")}`}>
        {link || t('no disponible')}
      </span>
    </div>
  );
}

function ShareActions({ label, universeId, kind, characterId }: { label: string; universeId: string; kind: 'universe' | 'character'; characterId?: string }) {
  const t = useCreatorShareText();
  const [link, setLink] = useState('');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState('');
  const [invite, setInvite] = useState('');
  const [collaborators, setCollaborators] = useState<Array<{collaborator_id:string;role:string}>>([]);
  useEffect(() => { setLink(''); setInvite(''); setError(''); }, [universeId, kind, characterId]);
  const generate = async () => {
    setBusy(true); setError('');
    try {
      const result = await customFetch<{ token: string }>('/api/universe/' + encodeURIComponent(universeId) + '/share-links', {
        method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ kind, ...(characterId ? { characterId } : {}) }), responseType: 'json',
      });
      const url = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + '/shared/' + result.token;
      setLink(url);
      return url;
    } catch { setError(t('No se pudo generar el enlace. Activá compartir universo desde Privacidad.')); return ''; }
    finally { setBusy(false); }
  };
  const copy = async () => { const url = link || await generate(); if (url) { try { await navigator.clipboard.writeText(url); } catch { setError(t('No se pudo copiar automáticamente.')); } } };
  const share = async () => {
    const url = link || await generate();
    if (!url) return;
    if (navigator.share) { try { await navigator.share({ title: label, url }); } catch { /* cancelled */ } }
    else { try { await navigator.clipboard.writeText(url); } catch { setError(t('No se pudo compartir automáticamente.')); } }
  };
  const createInvite = async () => {
    setBusy(true); setError('');
    try { const result = await customFetch<{token:string}>('/api/universe/' + encodeURIComponent(universeId) + '/collaboration-invites', {method:'POST',responseType:'json'});
      const url = window.location.origin + import.meta.env.BASE_URL.replace(/\/$/, '') + '/shared/' + result.token;
      setInvite(url);
      try { await navigator.clipboard.writeText(url); }
      catch { /* Keep the generated invitation visible for manual copying on mobile. */ }
    } catch { setError(t('No se pudo crear o copiar la invitación. Activá compartir desde Privacidad.')); }
    finally { setBusy(false); }
  };
  const loadCollaborators = async () => {
    try { setCollaborators(await customFetch<Array<{collaborator_id:string;role:string}>>('/api/universe/' + encodeURIComponent(universeId) + '/collaborators', {responseType:'json'})); }
    catch { setError(t('No se pudieron cargar las colaboradoras.')); }
  };
  const removeCollaborator = async (id:string) => {
    try { await customFetch('/api/universe/' + encodeURIComponent(universeId) + '/collaborators/' + encodeURIComponent(id), {method:'DELETE'}); await loadCollaborators(); }
    catch { setError(t('No se pudo quitar el acceso.')); }
  };
  const revokeInvite = async () => {
    if (!invite) return;
    try { await customFetch('/api/universe/' + encodeURIComponent(universeId) + '/share-links/' + invite.split('/').pop(), {method:'DELETE'}); setInvite(''); }
    catch { setError(t('No se pudo revocar la invitación.')); }
  };
  const revoke = async () => {
    if (!link) return;
    const token = link.split('/').pop()!;
    setBusy(true);
    try {
      await customFetch('/api/universe/' + encodeURIComponent(universeId) + '/share-links/' + token, { method: 'DELETE' });
      setLink('');
    } catch { setError(t('No se pudo revocar el enlace.')); }
    finally { setBusy(false); }
  };
  return <div className="mt-3">
    <LinkRow label={label} link={link} />
    <div className="mt-3 flex flex-wrap gap-2">
      <button type="button" disabled={busy} onClick={() => void copy()} className={disabledBtn.replace('opacity-55 cursor-not-allowed', '')}>{busy ? t('Generando…') : t('Copiar enlace')}</button>
      <button type="button" disabled={busy} onClick={() => void share()} className={disabledBtn.replace('opacity-55 cursor-not-allowed', '')}>{t('Compartir')}</button>
      {kind === 'universe' && <button type="button" disabled={busy} onClick={() => void createInvite()} className="tap inline-flex min-h-11 min-w-0 flex-1 items-center justify-center rounded-full border border-primary px-3 py-2 text-center text-[11px] font-semibold leading-tight text-primary whitespace-normal">{t("Invitar a colaborar")}</button>}
      {link && <button type="button" disabled={busy} onClick={() => void revoke()} className="min-h-11 rounded-full border border-border px-3 text-xs">{t("Revocar enlace")}</button>}
    </div>
    {invite && <div className="mt-2 break-all text-xs text-muted-foreground">{t("Invitación de colaboración: ")}{invite} <button type="button" onClick={() => void revokeInvite()} className="ml-2 underline">{t("Revocar invitación")}</button></div>}
    {kind === 'universe' && <div className="mt-3"><button type="button" onClick={() => void loadCollaborators()} className="text-xs text-primary underline">{t("Administrar colaboradoras")}</button>{collaborators.map(person => <div key={person.collaborator_id} className="mt-2 flex items-center gap-2 text-xs"><span className="min-w-0 flex-1 truncate">{person.collaborator_id}</span><button type="button" onClick={() => void removeCollaborator(person.collaborator_id)} className="underline">{t("Quitar acceso")}</button></div>)}</div>}
    {error && <p role="alert" className="mt-2 text-xs text-red-300">{error}</p>}
  </div>;
}

export function PrivateShareCards({ universeName, description, creatorName, characters, initialCharacterId, universeId }: PrivateShareCardsProps) {
  const t = useCreatorShareText();
  const selectId = useId();
  const noteId = useId();
  const [selectedId, setSelectedId] = useState<string | undefined>(
    characters.find((c) => c.id === initialCharacterId)?.id ?? characters[0]?.id,
  );
  const selected = characters.find((c) => c.id === selectedId) ?? characters[0];

  return (
    <section aria-labelledby={`${noteId}-h`} className="grid w-full min-w-0 gap-3 text-[#efdce8]" data-testid="private-share-cards">
      <div>
        <h2 id={`${noteId}-h`} className="m-0 text-[22px] font-normal" style={{ fontFamily: SERIF }}>{t("Tarjetas para compartir")}</h2>
        <p id={noteId} className="mt-1 mb-0 flex gap-2 text-[11px] leading-relaxed text-[#a59ba4]" data-testid="text-share-dependency">
          <span aria-hidden="true" className="mt-[6px] h-[6px] w-[6px] shrink-0 rounded-full bg-[#d9a8bd]" />
          {t("Los enlaces muestran una vista limitada y se pueden revocar. No incluyen conversaciones ni recuerdos privados.")}
        </p>
      </div>

      <div className="grid min-w-0 gap-3 lg:grid-cols-2">
        <article className={card} aria-labelledby={`${noteId}-u`} data-testid="card-share-universe">
          <span className={overline}>{t("Universo")}</span>
          <div className="epc-share-cover mt-3 w-full overflow-hidden rounded-[14px]" style={{ containerType: 'inline-size' }}>
            <UniverseCover name={universeName} />
          </div>
          <h3 id={`${noteId}-u`} className="mt-3 mb-0 text-[21px] font-normal leading-tight [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
            {universeName}
          </h3>
          {description ? <p className="mt-1 mb-0 text-[11px] leading-relaxed text-[#a59ba4] [overflow-wrap:anywhere]">{description}</p> : null}
          {creatorName ? <p className="mt-2 mb-0 text-[10px] text-[#8f8790]">{t("Por")} {creatorName}</p> : null}
          <div className="mt-auto"><ShareActions label="universo" universeId={universeId} kind="universe" /></div>
        </article>

        <article className={card} aria-labelledby={`${noteId}-c`} data-testid="card-share-character">
          <div className="flex items-center justify-between gap-2">
            <span className={overline}>{t("Personaje")}</span>
            {characters.length > 1 ? (
              <span className="min-w-0">
                <label htmlFor={selectId} className="sr-only">{t("Personaje de la tarjeta")}</label>
                <select
                  id={selectId}
                  value={selected?.id ?? ''}
                  onChange={(e) => setSelectedId(e.target.value)}
                  className="min-h-11 max-w-[150px] truncate rounded-full border border-[rgba(239,220,232,.14)] bg-[#1c191e] px-3 py-1 text-[10px] text-[#e3d4dd] focus:outline-none focus-visible:ring-2 focus-visible:ring-[#d9a8bd]"
                  data-testid="select-share-character"
                >
                  {characters.map((c) => (
                    <option key={c.id} value={c.id}>{c.name}</option>
                  ))}
                </select>
              </span>
            ) : null}
          </div>
          {selected ? (
            <>
              <div className="mt-4 flex min-w-0 items-center gap-3">
                {selected.imageSrc ? (
                  <img src={selected.imageSrc} alt={selected.name} width={56} height={56} draggable={false}
                    className="h-14 w-14 shrink-0 rounded-full object-cover" data-testid={`img-share-character-${selected.id}`} />
                ) : (
                  <CharacterInitials name={selected.name} size={56} testId={`initials-share-character-${selected.id}`} />
                )}
                <div className="min-w-0">
                  <h3 id={`${noteId}-c`} className="m-0 text-[21px] font-normal leading-tight [overflow-wrap:anywhere]" style={{ fontFamily: SERIF }}>
                    {selected.name}
                  </h3>
                  <p className="mt-1 mb-0 text-[10px] text-[#8f8790] [overflow-wrap:anywhere]">{t("En")} {universeName}</p>
                </div>
              </div>
              <div className="mt-auto"><ShareActions label="personaje" universeId={universeId} kind="character" characterId={selected.id} /></div>
            </>
          ) : (
            <p id={`${noteId}-c`} className="mt-4 mb-0 text-[11px] text-[#a59ba4]">{t("Este universo aún no tiene personajes.")}</p>
          )}
        </article>
      </div>
    </section>
  );
}
