import { useHighlightsText } from '@/lib/highlights-translations';
import { useRef, useState } from 'react';
import { Archive, ArrowDown, ArrowUp, Check, Pencil, Plus, Trash2 } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { uid } from '@/domain/events';
import { compressImage, uploadPrivateImage, useMediaResolver, timeAgo } from '@/lib/media';
import { getOrderedHighlights, highlightCover, isStoryActive, canViewStory } from '@/domain/social-features';
import { Sheet } from './sheet';
import { useStoryViewer } from './story-viewer';
import { toast } from '@/hooks/use-toast';
import { cn } from '@/lib/utils';
import type { StoryHighlight } from '@/domain/types';

export function HighlightsRow({ authorId, isMe }: { authorId: string; isMe: boolean }) {
  const t = useHighlightsText();
  const resolveMedia = useMediaResolver();
  const { state, me } = useSocial();
  const { openStoryList } = useStoryViewer();
  const [editing, setEditing] = useState<StoryHighlight | 'new' | null>(null);
  const [unavailable, setUnavailable] = useState<Record<string, string[]>>({});
  // Cover-only highlights remain visible on linked profiles even before stories are added.
  const highlights = getOrderedHighlights(state, authorId).filter(h => isMe || (h.storyIds.length === 0 && Boolean(h.coverImage)) || h.storyIds.some(id => { const s = state.stories.find(st => st.id === id); return s && canViewStory(s, me.id, state); }));
  const own = state.stories.filter((s) => s.authorId === authorId).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  if (!isMe && !highlights.length) return null;

  return (
    <div className="no-scrollbar mt-5 flex gap-4 overflow-x-auto" data-testid="row-highlights">
      {highlights.map((h) => {
        const hidden = state.stories.filter(s => h.storyIds.includes(s.id) && !canViewStory(s, me.id, state)).map(s => s.id);
        const cover = highlightCover(state, h, [...(unavailable[h.id] ?? []), ...hidden]);
        const customCover = h.coverImage;
        return (
          <div key={h.id} className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <button onClick={() => openStoryList(authorId, h.storyIds.filter(id => { const s = state.stories.find(st => st.id === id); return s && canViewStory(s, me.id, state); }))} className="tap h-16 w-16 overflow-hidden rounded-full border border-border bg-card p-[3px]" aria-label={`${t("Ver destacada")} ${h.title}`} data-testid={`button-highlight-${h.id}`}>
              <HighlightCover title={h.title} src={customCover ? resolveMedia(customCover) : cover ? resolveMedia(cover.image, { sourceType: 'story', sourceContentId: cover.id }) : ''} onError={() => { if (cover && !customCover) setUnavailable(previous => ({ ...previous, [h.id]: [...new Set([...(previous[h.id] ?? []), cover.id])] })); }} />
            </button>
            <span className="w-full truncate text-center text-[11.5px]">{h.title}</span>
            {isMe && <button onClick={() => setEditing(h)} className="-mt-2 grid h-11 w-11 place-items-center text-muted-foreground" aria-label={`${t("Editar")} ${h.title}`} data-testid={`button-highlight-edit-${h.id}`}><Pencil className="h-3.5 w-3.5" /></button>}
          </div>
        );
      })}
      {isMe && (
        <>
          <div className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <button onClick={() => setEditing('new')} className="tap grid h-16 w-16 place-items-center rounded-full border border-dashed border-border" aria-label={t("Nueva destacada")} data-testid="button-highlight-new"><Plus className="h-5 w-5" /></button>
            <span className="text-[11.5px] text-muted-foreground">{t("Nueva")}</span>
          </div>
          <div className="flex w-[68px] shrink-0 flex-col items-center gap-1.5">
            <button onClick={() => openStoryList(authorId, [...own].reverse().map((s) => s.id))} className="tap grid h-16 w-16 place-items-center rounded-full border border-border" aria-label={t("Archivo de historias")} data-testid="button-story-archive"><Archive className="h-5 w-5" strokeWidth={1.6} /></button>
            <span className="text-[11.5px] text-muted-foreground">{t("Archivo")}</span>
          </div>
        </>
      )}
      {editing && <HighlightEditor key={editing === 'new' ? 'new' : editing.id} initial={editing === 'new' ? null : editing} onClose={() => setEditing(null)} />}
    </div>
  );
}

function HighlightEditor({ initial, onClose }: { initial: StoryHighlight | null; onClose(): void }) {
  const t = useHighlightsText();
  const resolveMedia = useMediaResolver();
  const { state, me, actions } = useSocial();
  const [title, setTitle] = useState(initial?.title ?? '');
  const [ids, setIds] = useState<string[]>(initial?.storyIds ?? []);
  const [coverStoryId, setCoverStoryId] = useState<string | null>(initial?.coverStoryId ?? null);
  const [coverImage, setCoverImage] = useState(initial?.coverImage ?? '');
  const [uploadingCover, setUploadingCover] = useState(false);
  const coverInput = useRef<HTMLInputElement>(null);
  const uploadCover = async (file?: File) => {
    if (!file) return;
    if (!file.type.startsWith('image/')) { setError(t('Elegí una imagen para la portada.')); return; }
    setUploadingCover(true); setError(null);
    try { setCoverImage(await uploadPrivateImage(await compressImage(file, 1080))); }
    catch (e) { setError((e as Error).message); }
    finally { setUploadingCover(false); if (coverInput.current) coverInput.current.value = ''; }
  };
  const collections = getOrderedHighlights(state, me.id);
  const [position, setPosition] = useState(initial ? collections.findIndex(h => h.id === initial.id) : collections.length);
  const [confirm, setConfirm] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const own = state.stories.filter((s) => s.authorId === me.id).sort((a, b) => b.createdAt.localeCompare(a.createdAt));

  const save = () => {
    try {
      actions.saveHighlight({ id: initial?.id ?? uid('hl'), authorId: me.id, title: title.trim(), storyIds: ids,
        order: position, coverStoryId: coverStoryId && ids.includes(coverStoryId) ? coverStoryId : null,
        ...(coverImage ? { coverImage } : {}) }, initial ?? undefined);
      toast({ title: t(initial ? 'Destacada actualizada' : 'Destacada creada') });
      onClose();
    } catch (e) { setError((e as Error).message); }
  };

  return (
    <Sheet open onClose={onClose} title={t(confirm ? '¿Eliminar destacada?' : initial ? 'Editar destacada' : 'Nueva destacada')} testId="sheet-highlight"
      footer={confirm ? (
        <div className="flex gap-2">
          <button onClick={() => setConfirm(false)} className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-medium" data-testid="button-highlight-delete-cancel">{t("Cancelar")}</button>
          <button onClick={() => { actions.deleteHighlight(initial!.id); toast({ title: t('Destacada eliminada'), description: t('Las historias siguen en tu archivo.') }); onClose(); }} className="h-12 flex-1 rounded-2xl bg-destructive text-sm font-semibold text-destructive-foreground" data-testid="button-highlight-delete-confirm">{t("Eliminar")}</button>
        </div>
      ) : (
        <div className="flex gap-2">
          {initial && <button onClick={() => setConfirm(true)} aria-label={t("Eliminar destacada")} className="grid h-12 w-12 place-items-center rounded-2xl bg-secondary text-destructive" data-testid="button-highlight-delete"><Trash2 className="h-5 w-5" /></button>}
          <button onClick={save} disabled={!title.trim() || (!ids.length && !coverImage) || uploadingCover} className="h-12 flex-1 rounded-2xl bg-primary text-sm font-semibold text-primary-foreground disabled:opacity-40" data-testid="button-highlight-save">{t("Guardar")}</button>
        </div>
      )}>
      {confirm ? <p className="pb-2 text-sm text-muted-foreground">{t("Se quita la destacada del perfil. Las historias no se borran.")}</p> : (
        <div className="pb-2">
          <input value={title} onChange={(e) => setTitle(e.target.value.slice(0, 40))} placeholder={t("Título")} aria-label={t("Título de la destacada")}
            className="h-12 w-full rounded-2xl border border-input bg-card px-4 text-[15px] focus:border-primary/60 focus:outline-none" data-testid="input-highlight-title" />
          {initial && collections.length > 1 && (
            <div className="mt-3 flex items-center gap-2">
              <button type="button" aria-label={t("Mover destacada antes")} disabled={position <= 0} onClick={() => setPosition(p => p - 1)}
                className="grid h-11 w-11 place-items-center rounded-2xl bg-secondary disabled:opacity-40" data-testid="button-highlight-up"><ArrowUp className="h-[18px] w-[18px]" /></button>
              <span className="flex-1 text-center text-xs text-muted-foreground" aria-live="polite">{t("Posición")} {position + 1} {t("de")} {collections.length}</span>
              <button type="button" aria-label={t("Mover destacada después")} disabled={position >= collections.length - 1} onClick={() => setPosition(p => p + 1)}
                className="grid h-11 w-11 place-items-center rounded-2xl bg-secondary disabled:opacity-40" data-testid="button-highlight-down"><ArrowDown className="h-[18px] w-[18px]" /></button>
            </div>
          )}
          <p className="mt-3 text-xs text-muted-foreground">{ids.length} {t("seleccionada(s) · incluye historias vencidas")}</p>
          <div className="mt-2 grid grid-cols-3 gap-2">
            {own.map((s) => {
              const on = ids.includes(s.id);
              return (
                <button key={s.id} type="button" aria-pressed={on} onClick={() => { setIds(on ? ids.filter((i) => i !== s.id) : [...ids, s.id]); if (on && coverStoryId === s.id) setCoverStoryId(null); }}
                  className={cn('relative overflow-hidden rounded-xl border-2', on ? 'border-primary' : 'border-transparent')} data-testid={`button-highlight-story-${s.id}`}>
                  <img src={resolveMedia(s.image, { sourceType: 'story', sourceContentId: s.id })} alt={s.caption || t('Historia')} className="aspect-[9/16] w-full object-cover" />
                  <span className="absolute inset-x-0 bottom-0 bg-[hsl(240_8%_3%/0.65)] px-1.5 py-1 text-[10.5px]">{t(isStoryActive(s) ? 'Activa' : 'Vencida')} · {timeAgo(s.createdAt)}</span>
                  {on && <span className="absolute right-1.5 top-1.5 grid h-6 w-6 place-items-center rounded-full bg-primary text-primary-foreground"><Check className="h-3.5 w-3.5" /></span>}
                </button>
              );
            })}
          </div>
          <div className="mt-4 rounded-2xl border border-border p-3">
            <p className="text-xs font-semibold">{t("Portada personalizada")}</p>
            <p className="mt-1 text-xs text-muted-foreground">{t("Podés subir una foto diferente sin publicarla como historia.")}</p>
            {coverImage && <img src={resolveMedia(coverImage)} alt={t("Portada personalizada")} className="mt-3 h-24 w-24 rounded-full object-cover" />}
            <input ref={coverInput} type="file" accept="image/*" className="hidden" aria-label={t("Elegir portada personalizada")} onChange={e => void uploadCover(e.target.files?.[0])} data-testid="input-highlight-custom-cover" />
            <div className="mt-3 flex gap-2">
              <button type="button" disabled={uploadingCover} onClick={() => coverInput.current?.click()} className="h-11 rounded-xl bg-secondary px-4 text-xs font-semibold disabled:opacity-50" data-testid="button-highlight-upload-cover">{t(uploadingCover ? 'Subiendo…' : 'Subir portada')}</button>
              {coverImage && <button type="button" onClick={() => setCoverImage('')} className="h-11 rounded-xl bg-secondary px-4 text-xs" data-testid="button-highlight-remove-custom-cover">{t("Quitar portada")}</button>}
            </div>
          </div>
          {ids.length > 0 && (
            <div className="mt-3">
              <label htmlFor={`highlight-cover-${initial?.id ?? 'new'}`} className="text-xs text-muted-foreground">{t("Portada")}</label>
              <select id={`highlight-cover-${initial?.id ?? 'new'}`} value={coverStoryId && ids.includes(coverStoryId) ? coverStoryId : ''}
                onChange={e => { setCoverStoryId(e.target.value || null); setCoverImage(''); }} data-testid="select-highlight-cover"
                className="mt-2 h-12 w-full rounded-2xl border border-input bg-card px-4 text-[15px] focus:border-primary/60 focus:outline-none">
                <option value="">{t("Automática")}</option>
                {ids.map((id, i) => { const story = own.find(s => s.id === id); return story ? <option key={id} value={id}>{story.caption || `${t('Historia')} ${i + 1}`}</option> : null; })}
              </select>
            </div>
          )}
          {error && <p role="alert" className="mt-3 rounded-2xl bg-destructive/15 px-4 py-3 text-sm text-destructive" data-testid="text-highlight-error">{error}</p>}
        </div>
      )}
    </Sheet>
  );
}

/** Keep a legible branded cover visible until the private image is decoded. */
function HighlightCover({ title, src, onError }: { title: string; src: string; onError(): void }) {
  const [loadedSrc, setLoadedSrc] = useState<string | null>(null);
  const ready = Boolean(src && loadedSrc === src);
  return (
    <span className="relative grid h-full w-full place-items-center overflow-hidden rounded-full bg-gradient-to-br from-primary/35 via-secondary to-primary/20">
      {!ready && <span className="text-lg font-semibold text-foreground/80" aria-hidden="true">{title.trim().charAt(0).toLocaleUpperCase() || 'E'}</span>}
      {src && <img src={src} alt="" loading="eager" decoding="async"
        onLoad={() => setLoadedSrc(src)} onError={onError}
        className={cn('absolute inset-0 h-full w-full rounded-full object-cover transition-opacity duration-150', ready ? 'opacity-100' : 'opacity-0')} />}
    </span>
  );
}
