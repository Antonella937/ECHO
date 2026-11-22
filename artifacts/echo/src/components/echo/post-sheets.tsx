import { usePostInteractionsText } from '@/lib/post-interactions-translations';
import { useLanguage } from '@/lib/i18n';
import { dmSharePrompt } from '@/lib/dm-share-translations';
import { useState } from 'react';
import { Link, useLocation } from 'wouter';
import { ArrowDown, ArrowUp, Check, Copy, Link2, MessageCircleOff, MessageCircle, Pencil, Pin, PinOff, Share, Trash2, User, BookImage } from 'lucide-react';
import { EditPostSheet } from './edit-post-sheet';
import { useSocial } from '@/store/social-store';
import { Sheet } from './sheet';
import { CharacterAvatar } from './avatar';
import { CommentComposer, CommentList } from './comments-panel';
import { postUrl, useMediaResolver } from '@/lib/media';
import { toast } from '@/hooks/use-toast';
import type { Comment, Post } from '@/domain/types';
import { getOrderedPinnedPosts } from '@/domain/social-features';

export function CommentsSheet({ post, open, onClose }: { post: Post; open: boolean; onClose(): void }) {
  const t = usePostInteractionsText();
  const [replyTo, setReplyTo] = useState<Comment | null>(null);
  return (
    <Sheet
      open={open}
      onClose={onClose}
      title={t("Comentarios")}
      testId="sheet-comments"
      footer={<CommentComposer postId={post.id} replyTo={replyTo} onClearReply={() => setReplyTo(null)} />}
    >
      <CommentList postId={post.id} onReply={setReplyTo} />
    </Sheet>
  );
}

export function LikersSheet({ post, open, onClose }: { post: Post; open: boolean; onClose(): void }) {
  const t = usePostInteractionsText();
  const { character, me } = useSocial();
  const likers = post.likes.map(character).filter(Boolean);
  return (
    <Sheet open={open} onClose={onClose} title={t("Me gusta")} testId="sheet-likers">
      {likers.length === 0 ? (
        <p className="py-10 text-center text-sm text-muted-foreground">{t("Aún no le gusta a nadie.")}</p>
      ) : (
        <ul className="flex flex-col gap-1 pb-2">
          {likers.map((c) =>
            c ? (
              <li key={c.id}>
                <Link href={`/profile/${c.id}`} onClick={onClose} className="flex items-center gap-3 rounded-2xl p-2 hover:bg-secondary" data-testid={`link-liker-${c.id}`}>
                  <CharacterAvatar character={c} size={44} />
                  <div className="min-w-0 flex-1">
                    <div className="text-sm font-semibold">{c.handle}</div>
                    <div className="text-xs text-muted-foreground">{c.name}{c.id === me.id ? t(' · tú') : ''}</div>
                  </div>
                </Link>
              </li>
            ) : null,
          )}
        </ul>
      )}
    </Sheet>
  );
}

export function ShareSheet({ post, open, onClose }: { post: Post; open: boolean; onClose(): void }) {
  const t = usePostInteractionsText();
  const language = useLanguage();
  const { state, me, actions, character } = useSocial();
  const mediaUrl = useMediaResolver();
  const previewImage = post.image ? mediaUrl(post.image, { sourceType: 'post', sourceId: post.id }) : '';
  const [copied, setCopied] = useState(false);
  const [sentTo, setSentTo] = useState<string[]>([]);
  const [storyComposerOpen, setStoryComposerOpen] = useState(false);
  const [storyText, setStoryText] = useState('');
  const url = postUrl(post.id);
  const author = character(post.authorId);
  const canNativeShare = typeof navigator !== 'undefined' && 'share' in navigator;
  const friends = state.characters.filter((c) => c.id !== me.id && !c.archived);

  const nativeShare = async () => {
    try {
      await navigator.share({ title: `ECHO · ${author?.name ?? ''}`, text: post.caption, url });
      onClose();
    } catch {
      /* user cancelled */
    }
  };

  const copy = async () => {
    try {
      await navigator.clipboard.writeText(url);
      setCopied(true);
      toast({ title: t('Enlace copiado') });
      setTimeout(() => setCopied(false), 1800);
    } catch {
      toast({ title: t('No se pudo copiar'), description: t('Selecciona el enlace y cópialo a mano.') });
    }
  };

  const addToStory = () => {
    try {
      if (!post.image) throw new Error('Esta publicación no tiene una imagen para compartir.');
      actions.createStory({ image: post.image, caption: storyText.trim(), repostOfPostId: post.id });
      toast({ title: 'Publicación compartida en tu historia' });
      setStoryComposerOpen(false);
      setStoryText('');
      onClose();
    } catch (error) {
      toast({ title: 'No se pudo compartir', description: (error as Error).message });
    }
  };

  const sendTo = (id: string) => {
    actions.sendMessage(id, dmSharePrompt(language), { postId: post.id });
    setSentTo((s) => [...s, id]);
  };

  return (
    <Sheet open={open} onClose={onClose} title={t("Compartir")} testId="sheet-share">
      <button type="button" onClick={() => setStoryComposerOpen(true)} className="mb-5 flex h-12 w-full items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium" data-testid="button-share-to-story"><BookImage className="h-5 w-5" /> Agregar a mi historia</button>
      {storyComposerOpen && (
        <div className="mb-5 space-y-3 rounded-2xl border border-border bg-background p-3" data-testid="composer-repost-story">
          <div className="text-sm font-semibold">Vista previa de tu historia</div>
          <div className="relative mx-auto flex aspect-[9/13] max-h-[48dvh] w-full max-w-[300px] flex-col items-center justify-center overflow-hidden rounded-xl bg-[#19171d] p-5 text-white">
            <div className="w-full overflow-hidden rounded-xl bg-[#090909] shadow-xl">
              <div className="flex items-center gap-2 px-3 py-2 text-xs font-semibold">@{author?.handle ?? 'publicacion'}</div>
              {previewImage ? <img src={previewImage} alt="Vista previa de la publicación" className="max-h-[28dvh] w-full object-contain" /> : <div className="flex h-[25dvh] w-full items-center justify-center bg-gradient-to-br from-[#342b37] via-[#24212b] to-[#17161e]" role="status" aria-label="Cargando vista previa"><div className="h-7 w-7 animate-spin rounded-full border-2 border-white/20 border-t-white/80" /></div>}
              <div className="px-3 py-2 text-[10px] text-white/70">Ver publicación original</div>
            </div>
            {storyText.trim() && <p className="mt-4 max-w-full break-words text-center text-sm font-medium">{storyText}</p>}
          </div>
          <textarea value={storyText} onChange={e => setStoryText(e.target.value.slice(0, 500))} placeholder="Escribí algo sobre esta publicación..." aria-label="Texto de tu historia" maxLength={500} rows={3} className="w-full resize-none rounded-xl border border-border bg-secondary p-3 text-sm outline-none" data-testid="input-repost-story-text" />
          <div className="flex gap-2">
            <button type="button" onClick={() => setStoryComposerOpen(false)} className="h-11 flex-1 rounded-xl border border-border text-sm">Cancelar</button>
            <button type="button" onClick={addToStory} className="h-11 flex-1 rounded-xl bg-primary px-3 text-sm font-semibold text-primary-foreground" data-testid="button-publish-repost-story">Publicar historia</button>
          </div>
        </div>
      )}
      <div className="text-[11px] uppercase tracking-[0.18em] text-muted-foreground">{t("Enviar por mensaje")}</div>
      <div className="mt-3 flex gap-5">
        {friends.map((f) => {
          const sent = sentTo.includes(f.id);
          return (
            <button
              key={f.id}
              onClick={() => !sent && sendTo(f.id)}
              className="tap flex w-20 flex-col items-center gap-2"
              data-testid={`button-share-dm-${f.id}`}
            >
              <span className="relative">
                <CharacterAvatar character={f} size={56} />
                {sent && (
                  <span className="absolute inset-0 grid place-items-center rounded-full bg-[hsl(240_8%_3%/0.6)]">
                    <Check className="h-6 w-6 text-primary" />
                  </span>
                )}
              </span>
              <span className="text-xs">{sent ? t('Enviado') : f.name.split(' ')[0]}</span>
            </button>
          );
        })}
      </div>

      <div className="mt-6 flex flex-col gap-2 pb-2">
        {canNativeShare && (
          <button onClick={nativeShare} className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium" data-testid="button-share-native">
            <Share className="h-5 w-5" strokeWidth={1.6} /> Compartir con otra app
          </button>
        )}
        <button onClick={copy} className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium" data-testid="button-share-copy">
          {copied ? <Check className="h-5 w-5 text-primary" /> : <Copy className="h-5 w-5" strokeWidth={1.6} />}
          {t(copied ? 'Copiado' : 'Copiar enlace')}
        </button>
        <label className="mt-2 flex items-center gap-2 rounded-2xl border border-border px-3">
          <Link2 className="h-4 w-4 shrink-0 text-muted-foreground" />
          <input readOnly value={url} onFocus={(e) => e.currentTarget.select()} className="h-11 min-w-0 flex-1 bg-transparent text-xs text-muted-foreground focus:outline-none" aria-label={t("Enlace de la publicación")} data-testid="input-share-url" />
        </label>
        <p className="px-1 text-[11px] leading-relaxed text-muted-foreground">{t("El enlace solo abre la publicación en este dispositivo: los datos de ECHO aún no se sincronizan.")}</p>
      </div>
    </Sheet>
  );
}

export function OptionsSheet({ post, open, onClose }: { post: Post; open: boolean; onClose(): void }) {
  const t = usePostInteractionsText();
  const { state, me, actions, character } = useSocial();
  const [, navigate] = useLocation();
  const [confirm, setConfirm] = useState(false);
  const [editing, setEditing] = useState(false);
  const author = character(post.authorId);
  const mine = post.authorId === me.id;
  const pinned = getOrderedPinnedPosts(state, me.id);
  const pinIndex = pinned.findIndex(p => p.id === post.id);

  const close = () => {
    setConfirm(false);
    onClose();
  };

  const run = (fn: () => void, ok: string) => {
    try { fn(); toast({ title: ok }); close(); } catch (e) { toast({ title: t('No se pudo completar'), description: (e as Error).message }); }
  };

  return (
    <>
    <EditPostSheet post={post} open={editing} onClose={() => setEditing(false)} />
    <Sheet open={open} onClose={close} title={t(confirm ? '¿Eliminar publicación?' : 'Opciones')} testId="sheet-options">
      {confirm ? (
        <div className="pb-2">
          <p className="text-sm text-muted-foreground">{t("Se borrará de este dispositivo junto con sus comentarios. No se puede deshacer.")}</p>
          <div className="mt-5 flex gap-2">
            <button onClick={() => setConfirm(false)} className="h-12 flex-1 rounded-2xl bg-secondary text-sm font-medium" data-testid="button-cancel-delete">{t("Cancelar")}</button>
            <button
              onClick={() => {
                actions.deletePost(post.id);
                toast({ title: t('Publicación eliminada') });
                close();
                if (window.location.pathname.includes('/p/')) navigate(`/profile/${me.id}`);
              }}
              className="h-12 flex-1 rounded-2xl bg-destructive text-sm font-semibold text-destructive-foreground"
              data-testid="button-confirm-delete"
            >
              Eliminar
            </button>
          </div>
        </div>
      ) : (
        <div className="flex flex-col gap-2 pb-2">
          <button onClick={() => { close(); navigate(`/profile/${post.authorId}`); }} className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium" data-testid="button-option-profile">
            <User className="h-5 w-5" strokeWidth={1.6} /> {t('Ver perfil de')} {author?.name.split(' ')[0]}
          </button>
          <button
            onClick={async () => {
              try {
                await navigator.clipboard.writeText(postUrl(post.id));
                toast({ title: t('Enlace copiado') });
              } catch {
                toast({ title: t('No se pudo copiar'), description: postUrl(post.id) });
              }
              close();
            }}
            className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium"
            data-testid="button-option-copy"
          >
            <Copy className="h-5 w-5" strokeWidth={1.6} /> Copiar enlace
          </button>
          {mine && (
            <>
              <button onClick={() => { close(); setEditing(true); }} className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium" data-testid="button-option-edit">
                <Pencil className="h-5 w-5" strokeWidth={1.6} /> Editar publicación
              </button>
              <button onClick={() => run(() => actions.pinPost(post.id, !post.pinned), post.pinned ? 'Publicación desfijada' : 'Publicación fijada')} className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium" data-testid="button-option-pin">
                {post.pinned ? <PinOff className="h-5 w-5" strokeWidth={1.6} /> : <Pin className="h-5 w-5" strokeWidth={1.6} />} {t(post.pinned ? 'Desfijar del perfil' : 'Fijar en el perfil')}
              </button>
              {post.pinned && (
                <>
                  <button disabled={pinIndex <= 0} onClick={() => run(() => actions.movePinnedPost(post.id, -1), t('Orden actualizado'))}
                    className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium disabled:opacity-40" data-testid="button-option-pin-up">
                    <ArrowUp className="h-[18px] w-[18px]" /> Mover fijada arriba
                  </button>
                  <button disabled={pinIndex < 0 || pinIndex >= pinned.length - 1} onClick={() => run(() => actions.movePinnedPost(post.id, 1), t('Orden actualizado'))}
                    className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium disabled:opacity-40" data-testid="button-option-pin-down">
                    <ArrowDown className="h-[18px] w-[18px]" /> Mover fijada abajo
                  </button>
                </>
              )}
              <button onClick={() => { const on = post.commentsEnabled === false; run(() => actions.editPost(post.id, { commentsEnabled: on }, { commentsEnabled: post.commentsEnabled }), on ? 'Comentarios activados' : 'Comentarios desactivados'); }} className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium" data-testid="button-option-comments">
                {post.commentsEnabled === false ? <MessageCircle className="h-5 w-5" strokeWidth={1.6} /> : <MessageCircleOff className="h-5 w-5" strokeWidth={1.6} />} {t(post.commentsEnabled === false ? 'Activar comentarios' : 'Desactivar comentarios')}
              </button>
            </>
          )}
          {mine && (
            <button onClick={() => setConfirm(true)} className="flex h-12 items-center gap-3 rounded-2xl bg-secondary px-4 text-sm font-medium text-destructive" data-testid="button-option-delete">
              <Trash2 className="h-5 w-5" strokeWidth={1.6} /> Eliminar publicación
            </button>
          )}
        </div>
      )}
    </Sheet>
    </>
  );
}
