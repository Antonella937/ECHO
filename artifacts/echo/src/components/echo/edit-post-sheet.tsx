import { usePostComposeText } from '@/lib/post-compose-translations';
import { useEffect, useRef, useState } from 'react';
import { MapPin } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { Sheet } from './sheet';
import { AccountPicker } from './account-picker';
import { Switch } from '@/components/ui/switch';
import { toast } from '@/hooks/use-toast';
import type { Post } from '@/domain/types';
import type { PostEdit } from '@/domain/social-features';

type Draft = { caption: string; location: string; taggedAccountIds: string[]; commentsEnabled: boolean };
const snap = (p: Post) => ({ caption: p.caption, location: p.location, taggedAccountIds: p.taggedAccountIds, commentsEnabled: p.commentsEnabled });

export function EditPostSheet({ post, open, onClose }: { post: Post; open: boolean; onClose(): void }) {
  const t = usePostComposeText();
  const { actions, me } = useSocial();
  const original = useRef<ReturnType<typeof snap> | null>(null);
  const [draft, setDraft] = useState<Draft | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (open && !draft) {
      original.current = snap(post);
      setDraft({ caption: post.caption, location: post.location, taggedAccountIds: post.taggedAccountIds ?? [], commentsEnabled: post.commentsEnabled !== false });
      setError(null);
    }
  }, [open, draft, post]);

  if (!draft) return null;
  const close = () => { setDraft(null); setError(null); onClose(); };

  const save = () => {
    const o = original.current!;
    const patch: Partial<PostEdit> = {};
    const expected: Partial<PostEdit> = {};
    if (draft.caption !== o.caption) { patch.caption = draft.caption; expected.caption = o.caption; }
    if (draft.location !== o.location) { patch.location = draft.location; expected.location = o.location; }
    const tagsSame = JSON.stringify([...(o.taggedAccountIds ?? [])].sort()) === JSON.stringify([...draft.taggedAccountIds].sort());
    if (!tagsSame) { patch.taggedAccountIds = draft.taggedAccountIds; expected.taggedAccountIds = o.taggedAccountIds; }
    if (draft.commentsEnabled !== (o.commentsEnabled !== false)) { patch.commentsEnabled = draft.commentsEnabled; expected.commentsEnabled = o.commentsEnabled; }
    if (!Object.keys(patch).length) return close();
    try {
      actions.editPost(post.id, patch, expected);
      toast({ title: t('Publicación actualizada') });
      close();
    } catch (e) {
      setError((e as Error).message || t('No se pudo guardar. Tu borrador sigue aquí.'));
    }
  };

  return (
    <Sheet open={open} onClose={close} title={t("Editar publicación")} testId="sheet-edit-post"
      footer={<button onClick={save} className="tap h-12 w-full rounded-2xl bg-primary text-[15px] font-semibold text-primary-foreground" data-testid="button-edit-post-save">{t("Guardar cambios")}</button>}>
      <div className="pb-2">
        <textarea value={draft.caption} onChange={(e) => setDraft({ ...draft, caption: e.target.value.slice(0, 600) })} rows={3} aria-label={t("Pie de foto")}
          className="min-h-[88px] w-full resize-none rounded-2xl border border-input bg-card px-4 py-3 text-[15px] leading-relaxed focus:border-primary/60 focus:outline-none" data-testid="input-edit-caption" />
        <label className="mt-3 flex items-center gap-3 rounded-2xl border border-input bg-card px-4">
          <MapPin className="h-4 w-4 text-muted-foreground" strokeWidth={1.6} />
          <input aria-label={t("Ubicación")} value={draft.location} onChange={(e) => setDraft({ ...draft, location: e.target.value.slice(0, 80) })} placeholder={t("Añadir ubicación")}
            className="h-12 flex-1 bg-transparent text-[15px] placeholder:text-muted-foreground focus:outline-none" data-testid="input-edit-location" />
        </label>
        <AccountPicker label={t("Etiquetar cuentas")} value={draft.taggedAccountIds} onChange={(ids) => setDraft({ ...draft, taggedAccountIds: ids })} excludeId={me.id} testIdPrefix="button-edit-tag" />
        <label className="mt-3 flex items-center justify-between rounded-2xl border border-border px-4 py-3">
          <span><span className="block text-sm font-medium">{t("Permitir comentarios")}</span><span className="text-xs text-muted-foreground">{t("Los comentarios existentes se conservan.")}</span></span>
          <Switch checked={draft.commentsEnabled} onCheckedChange={(v) => setDraft({ ...draft, commentsEnabled: v })} data-testid="switch-edit-comments" />
        </label>
        {error && <p role="alert" className="mt-3 rounded-2xl bg-destructive/15 px-4 py-3 text-sm text-destructive" data-testid="text-edit-post-error">{error}</p>}
      </div>
    </Sheet>
  );
}
