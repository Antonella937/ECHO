import { VerifiedBadge } from '@/components/echo/verified-badge';
import { customFetch } from '@workspace/api-client-react';
import { useUser } from '@clerk/react';
import { getActiveUniverseId } from '@/store/persistence';
import { useCallback, useEffect, useMemo, useRef, useState, type FormEvent } from 'react';
import { Link, useParams } from 'wouter';
import { ChevronLeft, CornerUpLeft, Mic, Paperclip, Send, Smile, Square, Trash2, X } from 'lucide-react';
import { useSocial } from '@/store/social-store';
import { useThreadMessages } from '@/hooks/use-social-selectors';
import { CharacterAvatar } from '@/components/echo/avatar';
import { EmptyState } from '@/components/echo/skeletons';
import { useBack } from '@/components/echo/top-bar';
import { AttachmentView } from '@/components/echo/dm-attachment-view';
import { useMediaResolver, timeAgo } from '@/lib/media';
import { formatDuration, kindOf, uploadAttachment, validateAttachments, MAX_RECORDING_MS } from '@/lib/dm-attachments';
import { useVoiceRecorder } from '@/lib/use-voice-recorder';
import { cn } from '@/lib/utils';
import { postMedia } from '@/domain/post-media';
import type { Message, MessageAttachment } from '@/domain/types';

const REACTIONS = ['❤', '😂', '😮', '😢', '🔥', '👏'];

interface Pending { key: string; kind: MessageAttachment['type']; preview: string; name: string; uploading: boolean; attachment?: MessageAttachment; error?: string }

export default function ConversationPage() {
  const { id } = useParams<{ id: string }>();
  const { user } = useUser();
  const [otherTyping, setOtherTyping] = useState(false);
  const { me, character, actions, state } = useSocial();
  const other = character(id);
  const messages = useThreadMessages(id);
  const back = useBack();
  const [text, setText] = useState('');
  const [quoteId, setQuoteId] = useState<string | null>(null);
  const [pending, setPending] = useState<Pending[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [recordingTip, setRecordingTip] = useState(false);
  const [reacting, setReacting] = useState<string | null>(null);
  const [hiding, setHiding] = useState<string | null>(null);
  const endRef = useRef<HTMLDivElement>(null);
  const fileRef = useRef<HTMLInputElement>(null);
  const pendingRef = useRef(pending); pendingRef.current = pending;
  const unreadCount = messages.filter((m) => m.recipientId === me.id && !m.readBy.includes(me.id)).length;
  const byId = useMemo(() => new Map(messages.map(m => [m.id, m])), [messages]);
  const lastMineId = useMemo(() => [...messages].reverse().find(m => m.senderId === me.id)?.id, [messages, me.id]);

  useEffect(() => {
    if (unreadCount > 0) actions.markThreadRead(id);
  }, [unreadCount, id, actions]);

  useEffect(() => {
    endRef.current?.scrollIntoView({ block: 'end' });
  }, [messages.length]);

  useEffect(() => {
    if (!id || !user?.id) { setOtherTyping(false); return; }
    let active = true;
    const check = async () => {
      try {
        const universeId = getActiveUniverseId(user.id);
        const result = await customFetch<{ typing: boolean }>(`/api/autonomy/typing?${new URLSearchParams({ universeId, characterId: id })}`, { method: 'GET', responseType: 'json', cache: 'no-store' });
        if (active) setOtherTyping(result.typing);
      } catch { if (active) setOtherTyping(false); }
    };
    void check();
    const timer = window.setInterval(() => void check(), 2000);
    return () => { active = false; window.clearInterval(timer); };
  }, [id, user?.id]);

  // Revoke local previews on unmount / route change.
  useEffect(() => () => pendingRef.current.forEach(p => URL.revokeObjectURL(p.preview)), [id]);
  useEffect(() => { setQuoteId(null); setPending([]); setError(null); }, [id]);

  // Keep the composer above the on-screen keyboard where visualViewport is available.
  useEffect(() => {
    const vv = window.visualViewport;
    if (!vv) return;
    const root = document.documentElement;
    const update = () => {
      const inset = Math.max(0, window.innerHeight - vv.height - vv.offsetTop);
      root.style.setProperty('--echo-keyboard-inset', `${Math.round(inset)}px`);
    };
    // Recalculate on keyboard resize, but do not force-scroll on every visual viewport event:
    // iOS fires viewport scroll events while the user is reading older messages.
    update();
    vv.addEventListener('resize', update);
    vv.addEventListener('scroll', update);
    return () => {
      vv.removeEventListener('resize', update);
      vv.removeEventListener('scroll', update);
      root.style.removeProperty('--echo-keyboard-inset');
    };
  }, []);

  const addFiles = useCallback((files: (File | Blob)[], meta?: { durationSeconds?: number }) => {
    setError(null);
    try { validateAttachments(files, pendingRef.current.length); }
    catch (e) { setError((e as Error).message); return; }
    for (const f of files) {
      const key = `${Date.now()}-${Math.random().toString(36).slice(2)}`;
      const entry: Pending = { key, kind: kindOf(f.type)!, preview: URL.createObjectURL(f), name: f instanceof File ? f.name : 'Nota de voz', uploading: true };
      setPending(p => [...p, entry]);
      uploadAttachment(f).then(
        a => setPending(p => p.map(x => x.key === key ? { ...x, uploading: false, attachment: { ...a, ...(meta?.durationSeconds && !a.durationSeconds ? { durationSeconds: Math.round(meta.durationSeconds) } : {}) } } : x)),
        e => setPending(p => p.map(x => x.key === key ? { ...x, uploading: false, error: (e as Error).message || 'No se pudo subir.' } : x)),
      );
    }
  }, []);

  const recorder = useVoiceRecorder(
    (blob, secs) => { setRecordingTip(false); addFiles([blob], { durationSeconds: secs }); },
    (msg) => { setRecordingTip(false); setError(msg); },
  );

  const remove = (key: string) => setPending(p => {
    const hit = p.find(x => x.key === key);
    if (hit) URL.revokeObjectURL(hit.preview);
    return p.filter(x => x.key !== key);
  });

  if (!other || other.id === me.id)
    return <EmptyState title="Conversación no disponible" body="No puedes escribirte a ti mismo, aunque a veces apetezca." />;

  const uploading = pending.some(p => p.uploading);
  const failed = pending.some(p => p.error);
  const ready = pending.filter(p => p.attachment).map(p => p.attachment!);
  const canSend = !uploading && !failed && recorder.status === 'idle' && (!!text.trim() || ready.length > 0);
  const quoted = quoteId ? byId.get(quoteId) : undefined;

  const submit = (e: FormEvent) => {
    e.preventDefault();
    if (!canSend) return;
    try {
      actions.sendMessage(other.id, text, { ...(quoted ? { quoteMessageId: quoted.id } : {}), ...(ready.length ? { attachments: ready } : {}) });
      pending.forEach(p => URL.revokeObjectURL(p.preview));
      setText(''); setPending([]); setQuoteId(null); setError(null);
    } catch (err) {
      setError((err as Error).message || 'No se pudo enviar. Tu borrador sigue aquí.');
    }
  };

  const jumpTo = (mid: string) => {
    const el = document.querySelector(`[data-message-id="${mid}"]`);
    if (!el) return;
    el.scrollIntoView({ block: 'center', behavior: 'smooth' });
    el.classList.add('ring-2', 'ring-primary/50', 'rounded-2xl');
    window.setTimeout(() => el.classList.remove('ring-2', 'ring-primary/50', 'rounded-2xl'), 1400);
  };

  return (
    <div className="flex min-h-[100dvh] min-w-0 flex-col overflow-x-clip">
      <header className="sticky top-0 z-30 border-b border-border/60 bg-background/85 pt-safe backdrop-blur-xl">
        <div className="flex h-16 items-center gap-2 px-2">
          <button onClick={back} aria-label="Volver" className="tap grid h-11 w-11 place-items-center rounded-full hover:bg-secondary" data-testid="button-back">
            <ChevronLeft className="h-6 w-6" strokeWidth={1.6} />
          </button>
          <Link href={`/profile/${other.id}`} className="flex min-w-0 items-center gap-3" data-testid="link-conversation-profile">
            <CharacterAvatar character={other} size={38} />
            <div className="min-w-0 leading-tight">
              <div className="flex min-w-0 items-center gap-1 text-[15px] font-semibold"><span className="truncate">{other.name}</span><VerifiedBadge account={other} className="h-3.5 w-3.5 shrink-0" /></div>
              <div className="truncate text-xs text-muted-foreground">@{other.handle}</div>
            </div>
          </Link>
        </div>
      </header>

      <div className="min-w-0 flex-1 overflow-x-clip px-3 pb-4 pt-6 sm:px-4" data-testid="list-conversation-messages">
        <div className="mb-8 flex flex-col items-center text-center">
          <CharacterAvatar character={other} size={72} />
          <div className="mt-3 inline-flex items-center gap-1.5 font-display text-lg">{other.name}<VerifiedBadge account={other} /></div>
          <div className="text-xs text-muted-foreground">{other.occupation} · {other.location}</div>
        </div>
        {messages.length === 0 && <p className="text-center text-sm text-muted-foreground" data-testid="text-conversation-empty">Todavía no os habéis escrito. Envía el primer mensaje para empezar.</p>}
        <ul className="flex flex-col gap-1.5">
          {messages.map((m, i) => (
            <Bubble
              key={m.id} m={m} mine={m.senderId === me.id} meId={me.id} otherId={other.id}
              showTime={i === 0 || new Date(m.createdAt).getTime() - new Date(messages[i - 1].createdAt).getTime() > 3 * 3600_000}
              state={state} quoted={m.quoteMessageId ? byId.get(m.quoteMessageId) ?? null : undefined}
              names={{ [me.id]: 'Tú', [other.id]: other.name.split(' ')[0] }}
              isLastMine={m.id === lastMineId}
              reacting={reacting === m.id}
              onToggleReacting={() => setReacting(r => r === m.id ? null : m.id)}
              onReact={(v) => { try { actions.reactMessage(m.id, v); } catch (e) { setError((e as Error).message); } setReacting(null); }}
              onReply={() => setQuoteId(m.id)}
              onJump={jumpTo}
              hiding={hiding === m.id}
              onToggleHiding={() => setHiding(h => h === m.id ? null : m.id)}
              onHide={() => { try { actions.hideMessage(m.id); if (quoteId === m.id) setQuoteId(null); } catch (e) { setError((e as Error).message); } setHiding(null); }}
            />
          ))}
        </ul>
        {otherTyping && (
          <div className="mt-2 flex items-center gap-2" role="status" aria-label={`${other.name} está escribiendo`} data-testid="dm-typing-indicator">
            <CharacterAvatar character={other} size={26} />
            <div className="flex items-center gap-1 rounded-[20px] rounded-bl-md bg-secondary px-4 py-3" aria-hidden="true">
              {[0, 1, 2].map(i => <span key={i} className="h-2 w-2 animate-bounce rounded-full bg-muted-foreground" style={{ animationDelay: `${i * 160}ms`, animationDuration: "900ms" }} />)}
            </div>
          </div>
        )}
        <div ref={endRef} />
      </div>

      <form onSubmit={submit} className="sticky bottom-[var(--echo-keyboard-inset,0px)] z-40 border-t border-border/60 bg-background/90 px-3 pb-safe pt-2 backdrop-blur-xl" data-testid="form-composer">
        {error && (
          <div role="alert" className="mb-2 flex items-start gap-2 rounded-xl border border-destructive/40 bg-destructive/10 px-3 py-2 text-xs text-destructive" data-testid="text-composer-error">
            <span className="flex-1">{error}</span>
            <button type="button" onClick={() => setError(null)} aria-label="Cerrar aviso" data-testid="button-dismiss-composer-error"><X className="h-3.5 w-3.5" /></button>
          </div>
        )}
        {quoteId && (
          <div className="mb-2 flex items-center gap-2 rounded-xl border-l-2 border-primary bg-secondary/70 px-3 py-2" data-testid="composer-quote">
            <CornerUpLeft className="h-3.5 w-3.5 shrink-0 text-primary" />
            <div className="min-w-0 flex-1 text-xs">
              <div className="font-semibold">Respondiendo a {quoted ? (quoted.senderId === me.id ? 'ti' : other.name.split(' ')[0]) : 'un mensaje'}</div>
              <div className="truncate text-muted-foreground">{quoted ? summarize(quoted) : 'Mensaje no disponible'}</div>
            </div>
            <button type="button" onClick={() => setQuoteId(null)} aria-label="Cancelar cita" className="tap grid h-8 w-8 place-items-center rounded-full hover:bg-background" data-testid="button-cancel-quote"><X className="h-4 w-4" /></button>
          </div>
        )}
        {recorder.status === 'recording' && recordingTip && <p className="mb-2 text-center text-xs text-muted-foreground">Grabando… Tocá el cuadrado para terminar y escuchar antes de enviar. El tacho descarta la nota.</p>}
        {pending.length > 0 && (
          <ul className="mb-2 flex gap-2 overflow-x-auto pb-1" data-testid="list-pending-attachments">
            {pending.map(p => (
              <li key={p.key} className={cn('relative shrink-0 overflow-hidden rounded-xl border bg-card', p.error ? 'border-destructive' : 'border-border')} data-testid={`pending-attachment-${p.key}`}>
                {p.kind === 'image' && <img src={p.preview} alt="" className="h-20 w-20 object-cover" />}
                {p.kind === 'video' && <video src={p.preview} muted playsInline preload="metadata" className="h-20 w-20 object-cover" />}
                {p.kind === 'audio' && <audio src={p.preview} controls preload="metadata" className="h-10 w-56 m-2" />}
                {(p.uploading || p.error) && (
                  <span className={cn('absolute inset-x-0 bottom-0 px-1.5 py-0.5 text-[10px]', p.error ? 'bg-destructive text-destructive-foreground' : 'bg-background/80 text-muted-foreground')}>
                    {p.error ? 'Error al subir' : 'Subiendo…'}
                  </span>
                )}
                <button type="button" onClick={() => remove(p.key)} aria-label={`Quitar ${p.name}`} className="absolute right-1 top-1 grid h-6 w-6 place-items-center rounded-full bg-background/90" data-testid={`button-remove-attachment-${p.key}`}>
                  <X className="h-3.5 w-3.5" />
                </button>
              </li>
            ))}
          </ul>
        )}
        {recorder.status !== 'idle' ? (
          <div className="flex items-center gap-2 pb-1" data-testid="status-recording">
            <button type="button" onClick={() => { recorder.cancel(); setRecordingTip(false); }} aria-label="Descartar grabación" className="tap grid h-12 w-12 place-items-center rounded-full bg-secondary" data-testid="button-cancel-recording"><Trash2 className="h-5 w-5" /></button>
            <div className="flex h-12 flex-1 items-center gap-2 rounded-full border border-primary/50 bg-card px-5 text-[15px]">
              <span className="h-2.5 w-2.5 animate-pulse rounded-full bg-destructive" />
              <span role="status" aria-live="off">{recorder.status === 'requesting' ? 'Pidiendo micrófono…' : `${formatDuration(recorder.elapsed)} / ${formatDuration(MAX_RECORDING_MS / 1000)}`}</span>
            </div>
            <button type="button" onClick={() => { recorder.stop(); setRecordingTip(false); }} disabled={recorder.status !== 'recording'} aria-label="Detener grabación" className="tap grid h-12 w-12 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-35" data-testid="button-stop-recording"><Square className="h-4 w-4 fill-current" /></button>
          </div>
        ) : (
          <div className="flex items-center gap-2 pb-1">
            <input ref={fileRef} type="file" multiple hidden accept="image/*,video/mp4,video/webm,audio/webm,audio/ogg,audio/mp4,audio/mpeg,audio/wav,audio/x-wav"
              onChange={(e) => { addFiles(Array.from(e.target.files ?? [])); e.target.value = ''; }} data-testid="input-attachment-file" />
            <button type="button" onClick={() => fileRef.current?.click()} aria-label="Adjuntar foto, video o audio" className="tap grid h-11 w-11 shrink-0 place-items-center rounded-full hover:bg-secondary" data-testid="button-attach">
              <Paperclip className="h-5 w-5" strokeWidth={1.7} />
            </button>
            <input
              value={text}
              onChange={(e) => setText(e.target.value)}
              placeholder={`Escribir como ${me.name.split(' ')[0]}…`}
              className="h-12 min-w-0 flex-1 rounded-full border border-input bg-card px-5 text-[15px] placeholder:text-muted-foreground focus:border-primary/60 focus:outline-none"
              aria-label={`Mensaje para ${other.name}`}
              data-testid="input-message"
            />
            {!text.trim() && ready.length === 0 && !uploading ? (
              <button type="button" onClick={() => { setRecordingTip(true); void recorder.start(); }} aria-label="Grabar nota de voz" className="tap grid h-12 w-12 shrink-0 place-items-center rounded-full bg-secondary" data-testid="button-record-voice">
                <Mic className="h-5 w-5" strokeWidth={1.8} />
              </button>
            ) : (
              <button type="submit" disabled={!canSend} aria-label="Enviar mensaje" className="tap grid h-12 w-12 shrink-0 place-items-center rounded-full bg-primary text-primary-foreground disabled:opacity-35" data-testid="button-send-message">
                <Send className="h-5 w-5" strokeWidth={1.8} />
              </button>
            )}
          </div>
        )}
      </form>
    </div>
  );
}

function summarize(m: Message): string {
  if (m.text) return m.text;
  const a = m.attachments?.[0];
  if (a) return a.type === 'image' ? 'Foto' : a.type === 'video' ? 'Video' : 'Nota de voz';
  if (m.postId) return 'Publicación compartida';
  if (m.storyId) return 'Historia';
  return 'Mensaje';
}

function Bubble({ m, mine, meId, otherId, showTime, state, quoted, names, isLastMine, reacting, onToggleReacting, onReact, onReply, onJump, hiding, onToggleHiding, onHide }: {
  m: Message; mine: boolean; meId: string; otherId: string; showTime: boolean; state: ReturnType<typeof useSocial>['state'];
  quoted: Message | null | undefined; names: Record<string, string>; isLastMine: boolean; reacting: boolean;
  onToggleReacting(): void; onReact(v: string): void; onReply(): void; onJump(id: string): void;
  hiding: boolean; onToggleHiding(): void; onHide(): void;
}) {
  const resolveMedia = useMediaResolver();
  const story = m.storyId ? state.stories.find((s) => s.id === m.storyId) : undefined;
  const post = m.postId ? state.posts.find((p) => p.id === m.postId) : undefined;
  const reactions = m.reactions ?? [];
  const mineReaction = reactions.find(r => r.actorId === meId)?.value;
  return (
    <li className={cn('fade-up group flex min-w-0 max-w-full flex-col transition-shadow', mine ? 'items-end' : 'items-start')} data-testid={`message-${m.id}`} data-message-id={m.id}>
      {showTime && <span className="my-3 self-center text-[11px] text-muted-foreground">{timeAgo(m.createdAt)}</span>}
      {m.storyId && (
        <div className={cn('mb-1 flex flex-col gap-1', mine ? 'items-end' : 'items-start')}>
          <span className="text-[11px] text-muted-foreground">{story?.reactions?.some(r => r.actorId === m.senderId && r.value === m.text) || REACTIONS.includes(m.text)
            ? (mine ? 'Reaccionaste a su historia' : 'Reaccionó a tu historia')
            : (mine ? 'Respondiste a su historia' : 'Respondió a tu historia')}</span>
          {story ? (
            <img src={resolveMedia(story.image, { sourceType: 'story', sourceContentId: story.id })} alt="Historia" className="h-36 w-24 rounded-xl object-cover opacity-90" />
          ) : (
            <span className="rounded-xl border border-border px-3 py-2 text-xs text-muted-foreground">Historia no disponible</span>
          )}
        </div>
      )}
      {post && (
        <Link href={`/p/${post.id}`} className="mb-1 block w-48 overflow-hidden rounded-2xl border border-border bg-card" data-testid={`link-shared-post-${m.id}`}>
          {postMedia(post).length > 0 && <img src={resolveMedia(post.image, { sourceType: 'post', sourceContentId: post.id })} alt="" className="aspect-[4/5] w-full object-cover" />}
          <p className="truncate px-3 py-2 text-xs text-muted-foreground">{post.caption}</p>
        </Link>
      )}
      {quoted !== undefined && (
        <button type="button" disabled={!quoted} onClick={() => quoted && onJump(quoted.id)}
          className={cn('mb-0.5 max-w-[70%] rounded-2xl border-l-2 border-primary/70 bg-secondary/60 px-3 py-1.5 text-left text-xs', mine ? 'mr-1' : 'ml-1')}
          data-testid={`button-quote-${m.id}`}>
          <span className="block font-semibold text-muted-foreground">{quoted ? names[quoted.senderId] ?? '' : ''}</span>
          <span className="line-clamp-2 text-muted-foreground">{quoted ? summarize(quoted) : 'Mensaje no disponible'}</span>
        </button>
      )}
      {m.attachments?.length ? (
        <div className={cn('mb-1 flex flex-col gap-1.5', mine ? 'items-end' : 'items-start')}>
          {m.attachments.map(a => <AttachmentView key={a.id} a={a} mine={mine} messageId={m.id} />)}
        </div>
      ) : null}
      <div className={cn('flex w-full min-w-0 max-w-full items-center gap-1', mine ? 'flex-row-reverse' : 'flex-row')}>
        {m.text && (
          <p
            className={cn(
              'min-w-0 max-w-[calc(100%-7rem)] whitespace-pre-wrap break-words [overflow-wrap:anywhere] rounded-[22px] px-4 py-2.5 text-[15px] leading-snug',
              mine ? 'rounded-br-md bg-primary text-primary-foreground' : 'rounded-bl-md bg-secondary text-foreground',
            )}
          >
            {m.text}
          </p>
        )}
        <span className="flex shrink-0 opacity-60 transition-opacity group-hover:opacity-100">
          <button type="button" onClick={onReply} aria-label="Responder" className="tap grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary" data-testid={`button-reply-${m.id}`}><CornerUpLeft className="h-4 w-4" /></button>
          <button type="button" onClick={onToggleReacting} aria-label="Reaccionar" aria-expanded={reacting} className="tap grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary" data-testid={`button-react-${m.id}`}><Smile className="h-4 w-4" /></button>
          <button type="button" onClick={onToggleHiding} aria-label="Eliminar para mí" aria-expanded={hiding} className="tap grid h-8 w-8 place-items-center rounded-full text-muted-foreground hover:bg-secondary" data-testid={`button-hide-${m.id}`}><Trash2 className="h-4 w-4" /></button>
        </span>
      </div>
      {hiding && (
        <div role="alertdialog" aria-label="Eliminar mensaje para mí" className="mt-1 flex items-center gap-2 rounded-2xl border border-border bg-card px-3 py-2 text-xs shadow-sm" data-testid={`confirm-hide-${m.id}`}>
          <span className="text-muted-foreground">Se oculta solo para ti; la otra cuenta lo sigue viendo.</span>
          <button type="button" onClick={onToggleHiding} className="h-9 rounded-full bg-secondary px-3 font-semibold" data-testid={`button-hide-cancel-${m.id}`}>Cancelar</button>
          <button type="button" onClick={onHide} className="h-9 rounded-full bg-destructive px-3 font-semibold text-destructive-foreground" data-testid={`button-hide-confirm-${m.id}`}>Eliminar</button>
        </div>
      )}
      {reacting && (
        <div role="menu" className="mt-1 flex gap-0.5 rounded-full border border-border bg-card px-1.5 py-1 shadow-sm" data-testid={`menu-reactions-${m.id}`}>
          {REACTIONS.map((r, i) => (
            <button key={r} type="button" onClick={() => onReact(r)} className={cn('tap grid h-9 w-9 place-items-center rounded-full text-lg', mineReaction === r && 'bg-primary/20')} data-testid={`button-reaction-${m.id}-${i}`}>{r}</button>
          ))}
        </div>
      )}
      {reactions.length > 0 && (
        <div className="-mt-1 flex gap-1" data-testid={`reactions-${m.id}`}>
          {reactions.map(r => (
            <button key={r.id} type="button" onClick={() => r.actorId === meId && onReact(r.value)} disabled={r.actorId !== meId}
              title={names[r.actorId]} className={cn('rounded-full border border-border bg-card px-1.5 text-sm leading-6', r.actorId === meId && 'border-primary/50')}
              data-testid={`reaction-${m.id}-${r.actorId}`}>{r.value}</button>
          ))}
        </div>
      )}
      {mine && isLastMine && (
        <span className="mt-0.5 text-[11px] text-muted-foreground" data-testid={`status-read-${m.id}`}>{m.readBy.includes(otherId) ? 'Visto' : 'Enviado'}</span>
      )}
    </li>
  );
}
